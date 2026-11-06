/**
 * Placements, scheduling and publishing (MKT-002, MKT-008, MKT-014–MKT-017, MKT-024–MKT-026).
 */
import { and, asc, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  isUniqueViolation,
  marketingContentItems,
  marketingIdeas,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import {
  PLACEMENT_VARIANTS,
  buildPlacementCode,
  calendarConflicts,
  checkPlacementScope,
  type ScheduleCandidate,
} from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import { cadenceOf, getAccountByCode } from './accounts';
import { getContentItem } from './content';
import { approvalValidity } from './placement-checks';
import { loadPolicy } from './policy';

export { approvalValidity, type PlacementRow } from './placement-checks';
export * from './placement-schedule';
export * from './placement-publishing';

export const createPlacementBody = z
  .object({
    accountCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,5}$/),
    variant: z.enum(PLACEMENT_VARIANTS).nullable().optional(),
  })
  .strict();

export async function createPlacement(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof createPlacementBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await getContentItem(tx, itemId, false, actor);
    if (item.state === 'archived')
      throw new InvalidStateTransitionError('Archived content cannot be placed.');
    const [idea] = await tx.select().from(marketingIdeas).where(eq(marketingIdeas.id, item.ideaId));
    if (!idea?.code)
      throw new InvalidStateTransitionError(
        'The idea has no code (quarantined); it cannot be placed.',
      );
    const account = await getAccountByCode(tx, input.accountCode);
    if (account.status === 'later' || account.status === 'retired') {
      throw new InvalidStateTransitionError(
        `${account.code} is ${account.status}; it does not take posts yet.`,
      );
    }
    let code: string;
    try {
      code = buildPlacementCode({
        ideaCode: idea.code,
        accountCode: account.code,
        platform: account.platform,
        variant: input.variant ?? null,
      });
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid placement.');
    }
    const scope = checkPlacementScope(
      { code: idea.code, scope: idea.scope, scopePrefixes: idea.scopePrefixes },
      {
        accountCode: account.code,
        platform: account.platform,
        scope: account.scope,
        examPrefixes: account.examPrefixes,
      },
      false,
    );
    if (!scope.valid) {
      throw new ValidationError('This placement breaks the account rules.', {
        details: { errors: scope.errors, warnings: scope.warnings },
      });
    }
    try {
      const [row] = await tx
        .insert(marketingPlacements)
        .values({
          code,
          ideaId: idea.id,
          contentItemId: item.id,
          accountId: account.id,
          variant: input.variant ?? null,
          status: 'planned',
          createdBy: actor.id,
        })
        .returning();
      await auditMarketing(tx, actor, {
        action: 'placement.created',
        entityType: 'placement',
        entityId: row!.id,
        after: row,
        requestId,
      });
      return { placement: row!, warnings: scope.warnings };
    } catch (error) {
      if (isUniqueViolation(error, 'placements_code_key')) {
        throw new ConflictError(
          `${code} already exists: one idea has at most one placement per account.`,
        );
      }
      throw error;
    }
  });
}

/** Calendar (MKT-017): scheduled and published placements in an IST date range, with conflicts. */
export async function listCalendar(
  db: Database,
  range: { from: Date; to: Date; accountCode?: string },
  scope?: SQL,
) {
  const rows = await db
    .select({
      p: marketingPlacements,
      accountCode: marketingSocialAccounts.code,
      platform: marketingSocialAccounts.platform,
      item: marketingContentItems,
    })
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
        inArray(marketingPlacements.status, ['scheduled', 'published']),
        or(
          and(
            gte(marketingPlacements.scheduledAt, range.from),
            lt(marketingPlacements.scheduledAt, range.to),
          ),
          and(
            gte(marketingPlacements.publishedAt, range.from),
            lt(marketingPlacements.publishedAt, range.to),
          ),
        ),
        range.accountCode ? eq(marketingSocialAccounts.code, range.accountCode) : undefined,
        scope,
      ),
    )
    .orderBy(asc(marketingPlacements.scheduledAt), asc(marketingPlacements.code));
  const accounts = await db.select().from(marketingSocialAccounts);
  const slots: ScheduleCandidate[] = [];
  for (const r of rows) {
    if (r.p.status !== 'scheduled' || !r.p.scheduledAt) continue;
    slots.push({
      placementId: r.p.id,
      placementCode: r.p.code,
      ideaId: r.p.ideaId,
      accountCode: r.accountCode,
      at: r.p.scheduledAt,
      groupId: r.p.placementGroupId,
      approval: r.item
        ? await approvalValidity(db, r.item)
        : { valid: false, reason: 'Not linked to content.' },
    });
  }
  const policy = await loadPolicy(db);
  const conflicts = calendarConflicts(slots, accounts.map(cadenceOf), policy);
  return rows.map((r) => ({
    ...r.p,
    accountCode: r.accountCode,
    platform: r.platform,
    contentTitle: r.item?.title ?? null,
    contentState: r.item?.state ?? null,
    conflicts: conflicts.get(r.p.id) ?? { hard: [], warnings: [] },
  }));
}

/** Placements not yet scheduled (planning board), narrowed by a content `scope` when given. */
export async function listPlannedPlacements(db: Database, scope?: SQL) {
  return db
    .select({ p: marketingPlacements, accountCode: marketingSocialAccounts.code })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .leftJoin(
      marketingContentItems,
      eq(marketingContentItems.id, marketingPlacements.contentItemId),
    )
    .where(and(eq(marketingPlacements.status, 'planned'), scope))
    .orderBy(asc(marketingPlacements.originalPublishAt), asc(marketingPlacements.code));
}
