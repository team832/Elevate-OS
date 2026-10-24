/**
 * Idea tracker (MKT-003, MKT-004, MKT-006 fields). Codes come from server/codes.ts; the
 * duplicate check is domain/duplicates.ts (warn; block only an exact normalised match in
 * the same course, backed by the unique index ideas_course_title_key).
 */
import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  marketingContentItems,
  marketingIdeas,
  marketingPlacements,
  marketingSocialAccounts,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import {
  COURSE_PREFIXES,
  EXAM_PREFIXES,
  IDEA_SCOPES,
  IDEA_STATUSES,
  detectDuplicateIdeas,
  normalizeTitle,
  type CoursePrefix,
  type DuplicateCheckResult,
  type IdeaScope,
  type IdeaStatus,
} from '../domain';
import { CALENDAR_ITEM_TYPES, CHANNELS, EFFORT_SIZES } from '../domain/calendar';
import { actorCan as can, assertCan, type Actor } from './access';
import { memberOptions } from './campaign-members';
import { auditMarketing, rowById } from './common';
import { allocateIdeaCode, type CodeAllocator } from './codes';
import { loadPolicy } from './policy';
import { myStaffId, teamWide } from './scope';

export type IdeaRow = typeof marketingIdeas.$inferSelect;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const ideaFieldsSchema = z.object({
  title: z.string().trim().min(3).max(300),
  pillar: optionalText(80),
  series: optionalText(120),
  objective: optionalText(1000),
  audience: optionalText(500),
  brief: optionalText(5000),
  /** Where the idea came from (WhatsApp note, competitor scan, comment …). */
  source: optionalText(300),
  masterAsset: optionalText(200),
  notes: optionalText(2000),
  scope: z.enum(IDEA_SCOPES).optional(),
  scopePrefixes: z.array(z.enum(EXAM_PREFIXES)).max(4).optional(),
  // Ideas board (brief §13); `audience` is the target audience.
  problemNeed: optionalText(2000),
  hypothesis: optionalText(2000),
  effort: z.enum(EFFORT_SIZES).nullish(),
  expectedOutcome: optionalText(1000),
  proposedFormat: z.enum(CALENDAR_ITEM_TYPES).nullish(),
  proposedChannel: z.enum(CHANNELS).nullish(),
  programmeId: z.uuid().nullish(),
  ownerStaffId: z.uuid().nullish(),
  campaignId: z.uuid().nullish(),
});

/** §13 fields copied as they are (null clears). */
const BOARD_FIELDS = [
  'problemNeed',
  'hypothesis',
  'effort',
  'expectedOutcome',
  'proposedFormat',
  'proposedChannel',
  'programmeId',
  'ownerStaffId',
  'campaignId',
] as const;
type IdeaInsert = typeof marketingIdeas.$inferInsert;
const boardValues = (input: Partial<Record<(typeof BOARD_FIELDS)[number], unknown>>) =>
  Object.fromEntries(
    BOARD_FIELDS.filter((k) => input[k] !== undefined).map((k) => [k, input[k] ?? null]),
  ) as Partial<IdeaInsert>;

/** The owner must be active Marketing & Growth staff; a vanished course or campaign is a 400. */
async function checkIdeaRefs(db: Database, ownerStaffId: string | null | undefined) {
  if (ownerStaffId && !(await memberOptions(db, ownerStaffId)).length)
    throw new ValidationError('The owner must be active Marketing & Growth staff.');
}
/** Who may name an idea's owner: a reviewer anyone; everyone else only themselves (I1). */
async function checkOwnerChange(db: Database, actor: Actor, ownerStaffId: string | null) {
  if (can(actor, 'marketing:content:approve')) return;
  if (!ownerStaffId || ownerStaffId !== (await myStaffId(db, actor.id)))
    throw new ForbiddenError('Only a reviewer can give an idea to someone else.');
}

/** The team-wide contributor grant edits and moves only ideas they created or own (I1, round 2). */
async function assertIdeaChangeable(db: Database, actor: Actor, idea: IdeaRow) {
  if (teamWide(actor) || idea.createdBy === actor.id) return;
  if (idea.ownerStaffId && idea.ownerStaffId === (await myStaffId(db, actor.id))) return;
  throw new ForbiddenError('You can change only ideas you created or own.');
}

const refError = (error: unknown) =>
  isForeignKeyViolation(error)
    ? new ValidationError('The course or campaign chosen no longer exists.')
    : error;

export const createIdeaBody = ideaFieldsSchema
  .extend({ coursePrefix: z.enum(COURSE_PREFIXES) })
  .strict();
export type CreateIdeaInput = z.output<typeof createIdeaBody>;

export const updateIdeaBody = ideaFieldsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Send at least one field to change.' });

export const ideaStatusBody = z
  .object({ status: z.enum(IDEA_STATUSES), reason: z.string().trim().max(500).optional() })
  .strict();

/** MKT-004 lifecycle: which status changes a person may make. */
const IDEA_TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  idea: ['in_development', 'ready', 'held', 'rejected', 'archived', 'submitted'],
  in_development: ['ready', 'held', 'rejected', 'archived', 'idea'],
  ready: ['in_development', 'held', 'archived'],
  held: ['idea', 'in_development', 'ready', 'rejected', 'archived'],
  rejected: ['idea', 'archived'],
  archived: [],
  // Review (brief §13): approving or requesting changes needs marketing:content:approve.
  submitted: ['approved', 'changes_requested', 'idea'],
  changes_requested: ['submitted', 'idea', 'archived'],
  approved: ['in_development', 'ready', 'held', 'archived'],
};

export function canChangeIdeaStatus(from: IdeaStatus, to: IdeaStatus): boolean {
  return IDEA_TRANSITIONS[from].includes(to);
}

function resolveScope(
  prefix: CoursePrefix,
  scope: IdeaScope | undefined,
  prefixes: readonly string[] | undefined,
): { scope: IdeaScope; scopePrefixes: string[] } {
  const s: IdeaScope = scope ?? (prefix === 'GEN' ? 'general' : 'single_exam');
  let list = [...new Set(prefixes ?? [])];
  if (s === 'single_exam') {
    if (prefix === 'GEN' && list.length !== 1) {
      throw new ValidationError(
        'A single-exam GEN idea must name exactly one exam in scopePrefixes.',
      );
    }
    if (prefix !== 'GEN') list = [prefix];
  }
  if (s === 'cross_exam' && list.length < 2) {
    throw new ValidationError(
      'A cross-exam idea (comparison / every path) must name at least two exams.',
    );
  }
  if (s !== 'single_exam' && s !== 'cross_exam') list = [];
  return { scope: s, scopePrefixes: list.sort() };
}

async function existingForDuplicateCheck(db: Database) {
  const rows = await db
    .select({
      id: marketingIdeas.id,
      code: marketingIdeas.code,
      legacyCode: marketingIdeas.legacyCode,
      title: marketingIdeas.title,
      coursePrefix: marketingIdeas.coursePrefix,
      status: marketingIdeas.status,
    })
    .from(marketingIdeas);
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? (r.legacyCode ? `${r.legacyCode} (quarantined)` : null),
    title: r.title,
    coursePrefix: r.coursePrefix,
    status: r.status,
  }));
}

export async function checkIdeaDuplicates(
  db: Database,
  input: { title: string; coursePrefix: CoursePrefix; excludeId?: string },
): Promise<DuplicateCheckResult> {
  const policy = await loadPolicy(db);
  return detectDuplicateIdeas(input, await existingForDuplicateCheck(db), {
    sameCourseThreshold: policy.duplicateThresholds.sameCourse,
    crossCourseThreshold: policy.duplicateThresholds.crossCourse,
    excludeId: input.excludeId,
  });
}

function exactDuplicateError(result: DuplicateCheckResult) {
  return new ConflictError(
    'An idea with the same normalised title already exists in this course. Reuse it instead of creating a duplicate.',
    { details: { duplicates: result.candidates.filter((c) => c.kind === 'exact_same_course') } },
  );
}

export async function createIdea(
  db: Database,
  actor: Actor,
  input: CreateIdeaInput,
  options: { requestId?: string; allocate?: CodeAllocator; maxAttempts?: number } = {},
): Promise<{ idea: IdeaRow; duplicates: DuplicateCheckResult }> {
  assertCan(actor, 'marketing:ideas:write');
  const allocate = options.allocate ?? allocateIdeaCode;
  const maxAttempts = options.maxAttempts ?? 5;
  const { scope, scopePrefixes } = resolveScope(
    input.coursePrefix,
    input.scope,
    input.scopePrefixes,
  );
  return withTransaction(db, async (tx) => {
    if (input.ownerStaffId) await checkOwnerChange(tx, actor, input.ownerStaffId);
    await checkIdeaRefs(tx, input.ownerStaffId);
    const duplicates = await checkIdeaDuplicates(tx, {
      title: input.title,
      coursePrefix: input.coursePrefix,
    });
    if (duplicates.decision === 'block') throw exactDuplicateError(duplicates);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Savepoint: a unique violation rolls back only this attempt, not the transaction.
        const idea = await tx.transaction(async (sp) => {
          const code = await allocate(sp as unknown as Database, input.coursePrefix);
          const [row] = await sp
            .insert(marketingIdeas)
            .values({
              code,
              coursePrefix: input.coursePrefix,
              title: input.title,
              normalizedTitle: normalizeTitle(input.title),
              pillar: input.pillar ?? null,
              series: input.series ?? null,
              objective: input.objective ?? null,
              audience: input.audience ?? null,
              brief: input.brief ?? null,
              origin: input.source ?? null,
              masterAsset: input.masterAsset ?? null,
              notes: input.notes ?? null,
              scope,
              scopePrefixes,
              ...boardValues(input),
              status: 'idea',
              createdBy: actor.id,
            })
            .returning();
          return row!;
        });
        await auditMarketing(tx, actor, {
          action: 'idea.created',
          entityType: 'idea',
          entityId: idea.id,
          after: idea,
          requestId: options.requestId,
          metadata: { attempt, duplicateDecision: duplicates.decision },
        });
        return { idea, duplicates };
      } catch (error) {
        if (isUniqueViolation(error, 'ideas_course_title_key'))
          throw exactDuplicateError(duplicates);
        if (isUniqueViolation(error, 'ideas_code_key') && attempt < maxAttempts) continue;
        throw refError(error);
      }
    }
    throw new ConflictError('Could not allocate a free idea code; try again.');
  });
}

export interface IdeaListFilters {
  q?: string;
  coursePrefix?: CoursePrefix;
  status?: IdeaStatus;
  quarantined?: boolean;
  limit?: number;
}

/** Ideas with their owner's name (null = no owner). */
export async function listIdeas(
  db: Database,
  filters: IdeaListFilters = {},
): Promise<(IdeaRow & { ownerName: string | null })[]> {
  const where: SQL[] = [];
  if (filters.coursePrefix) where.push(eq(marketingIdeas.coursePrefix, filters.coursePrefix));
  if (filters.status) where.push(eq(marketingIdeas.status, filters.status));
  if (filters.quarantined !== undefined) {
    where.push(eq(marketingIdeas.quarantineState, filters.quarantined ? 'quarantined' : 'none'));
  }
  if (filters.q) {
    const term = `%${filters.q.replace(/[%_]/g, '')}%`;
    where.push(
      or(
        ilike(marketingIdeas.title, term),
        ilike(marketingIdeas.code, term),
        ilike(marketingIdeas.legacyCode, term),
      )!,
    );
  }
  return db
    .select({ ...getTableColumns(marketingIdeas), ownerName: staffMembers.fullName })
    .from(marketingIdeas)
    .leftJoin(staffMembers, eq(staffMembers.id, marketingIdeas.ownerStaffId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(
      asc(marketingIdeas.coursePrefix),
      asc(marketingIdeas.code),
      asc(marketingIdeas.legacyRef),
    )
    .limit(Math.min(filters.limit ?? 500, 500));
}

export const getIdea = (db: Database, id: string): Promise<IdeaRow> =>
  rowById(db, marketingIdeas, id, 'Idea not found.');

/** The idea with its content items and placements; `contentScope` (scope.ts contentFilter) narrows both. */
export async function getIdeaDetail(db: Database, id: string, contentScope?: SQL) {
  const idea = await getIdea(db, id);
  const items = await db
    .select()
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.ideaId, idea.id), contentScope))
    .orderBy(desc(marketingContentItems.createdAt));
  // Placements follow their content item's scope; unlinked ones only for team-wide readers.
  const placements = await db
    .select({ placement: marketingPlacements, accountCode: marketingSocialAccounts.code })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .leftJoin(
      marketingContentItems,
      eq(marketingContentItems.id, marketingPlacements.contentItemId),
    )
    .where(
      and(
        idea.legacyCode && idea.quarantineState === 'quarantined'
          ? or(
              eq(marketingPlacements.ideaId, idea.id),
              eq(marketingPlacements.legacyIdeaCode, idea.legacyCode),
            )
          : eq(marketingPlacements.ideaId, idea.id),
        contentScope,
      ),
    )
    .orderBy(asc(marketingPlacements.code), asc(marketingPlacements.legacyCode));
  const duplicates = await checkIdeaDuplicates(db, {
    title: idea.title,
    coursePrefix: idea.coursePrefix,
    excludeId: idea.id,
  });
  return {
    idea,
    contentItems: items,
    placements: placements.map((p) => ({ ...p.placement, accountCode: p.accountCode })),
    duplicates,
  };
}

export async function updateIdea(
  db: Database,
  actor: Actor,
  id: string,
  patch: z.output<typeof updateIdeaBody>,
  requestId?: string,
): Promise<{ idea: IdeaRow; duplicates: DuplicateCheckResult | null }> {
  assertCan(actor, 'marketing:ideas:write');
  return withTransaction(db, async (tx) => {
    const before = await getIdea(tx, id);
    await assertIdeaChangeable(tx, actor, before);
    if (patch.ownerStaffId !== undefined && patch.ownerStaffId !== before.ownerStaffId) {
      await checkOwnerChange(tx, actor, patch.ownerStaffId);
      await checkIdeaRefs(tx, patch.ownerStaffId);
    }
    if (before.status === 'archived')
      throw new InvalidStateTransitionError('Archived ideas cannot be edited.');
    // Approval covers what was reviewed; change the status to In development to edit again.
    if (before.status === 'approved')
      throw new InvalidStateTransitionError(
        'An approved idea is locked. Move it to In development to edit it; it then needs review again.',
      );
    let duplicates: DuplicateCheckResult | null = null;
    const set: Partial<IdeaInsert> = boardValues(patch);
    if (patch.title !== undefined && patch.title !== before.title) {
      duplicates = await checkIdeaDuplicates(tx, {
        title: patch.title,
        coursePrefix: before.coursePrefix,
        excludeId: before.id,
      });
      if (duplicates.decision === 'block') throw exactDuplicateError(duplicates);
      set.title = patch.title;
      set.normalizedTitle = normalizeTitle(patch.title);
    }
    for (const k of [
      'pillar',
      'series',
      'objective',
      'audience',
      'brief',
      'masterAsset',
      'notes',
    ] as const) {
      if (patch[k] !== undefined) set[k] = patch[k] ?? null;
    }
    if (patch.source !== undefined) set.origin = patch.source ?? null;
    if (patch.scope !== undefined || patch.scopePrefixes !== undefined) {
      const r = resolveScope(
        before.coursePrefix,
        patch.scope ?? before.scope,
        patch.scopePrefixes ?? before.scopePrefixes,
      );
      set.scope = r.scope;
      set.scopePrefixes = r.scopePrefixes;
    }
    try {
      const [after] = await tx
        .update(marketingIdeas)
        .set(set)
        .where(eq(marketingIdeas.id, before.id))
        .returning();
      await auditMarketing(tx, actor, {
        action: 'idea.updated',
        entityType: 'idea',
        entityId: before.id,
        before,
        after,
        requestId,
      });
      return { idea: after!, duplicates };
    } catch (error) {
      if (isUniqueViolation(error, 'ideas_course_title_key') && duplicates)
        throw exactDuplicateError(duplicates);
      throw refError(error);
    }
  });
}

export async function changeIdeaStatus(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof ideaStatusBody>,
  requestId?: string,
): Promise<IdeaRow> {
  assertCan(actor, 'marketing:ideas:write');
  return withTransaction(db, async (tx) => {
    const before = await getIdea(tx, id);
    await assertIdeaChangeable(tx, actor, before);
    if (!canChangeIdeaStatus(before.status, input.status)) {
      throw new InvalidStateTransitionError(
        `An idea cannot go from ${before.status} to ${input.status}.`,
      );
    }
    if (input.status === 'approved' || input.status === 'changes_requested') {
      assertCan(actor, 'marketing:content:approve');
      const mine =
        before.createdBy === actor.id ||
        (before.ownerStaffId !== null && before.ownerStaffId === (await myStaffId(tx, actor.id)));
      if (mine)
        throw new ForbiddenError(
          'Another approver must review an idea you own (no self-approval).',
        );
    }
    if (['rejected', 'held', 'changes_requested'].includes(input.status) && !input.reason) {
      throw new ValidationError('Give a reason when holding, rejecting or sending back an idea.');
    }
    const [after] = await tx
      .update(marketingIdeas)
      .set({ status: input.status, statusReason: input.reason ?? null })
      .where(eq(marketingIdeas.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'idea.status_changed',
      entityType: 'idea',
      entityId: before.id,
      before: { status: before.status },
      after: { status: after!.status, reason: input.reason ?? null },
      requestId,
    });
    return after!;
  });
}

/** Quarantined legacy rows grouped by their shared legacy code (OD-003). */
export async function listQuarantine(db: Database) {
  const rows = await db
    .select()
    .from(marketingIdeas)
    .where(eq(marketingIdeas.quarantineState, 'quarantined'))
    .orderBy(asc(marketingIdeas.legacyCode), asc(marketingIdeas.legacyRef));
  const placements = await db
    .select({ placement: marketingPlacements, accountCode: marketingSocialAccounts.code })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(
      rows.length
        ? inArray(marketingPlacements.legacyIdeaCode, [
            ...new Set(rows.map((r) => r.legacyCode!).filter(Boolean)),
          ])
        : eq(marketingPlacements.ambiguous, true),
    );
  const groups = new Map<
    string,
    { legacyCode: string; ideas: IdeaRow[]; ambiguousPlacements: typeof placements }
  >();
  for (const r of rows) {
    const key = r.legacyCode ?? 'unknown';
    const g = groups.get(key) ?? { legacyCode: key, ideas: [], ambiguousPlacements: [] };
    g.ideas.push(r);
    groups.set(key, g);
  }
  for (const p of placements) {
    if (!p.placement.ambiguous) continue;
    groups.get(p.placement.legacyIdeaCode ?? '')?.ambiguousPlacements.push(p);
  }
  return [...groups.values()];
}
