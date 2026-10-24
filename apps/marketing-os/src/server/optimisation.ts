/**
 * SEO / AIO / GEO work (brief 23 Oct 2026 §14, SCHEMA-CONTRACT-MKT): work items with a checklist
 * and evidence, a review (never by the item's own person), and an append-only log of manual
 * observations. Everyone in Marketing reads all items; employees change only their own
 * (own = owner_staff_id is theirs or they created it). Every change is audited.
 */
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { scopeFor } from '@elevate/authorization';
import {
  MARKETING_REVIEW_STATES,
  auditEvents,
  marketingOptimisationCategories as categories,
  marketingOptimisationItems as items,
  marketingOptimisationObservations as observations,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import { toIsoDate } from '@elevate/shared-types';
import {
  OPTIMISATION_CHECK_KEYS,
  buildChecklist,
  isEditable,
  type ReviewState,
} from '../domain/optimisation';
import { assertCan, type Actor } from './access';
import { memberOptions } from './campaign-members';
import { auditMarketing, rowById } from './common';
import { myStaffId } from './scope';

type Item = typeof items.$inferSelect;
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => text(max).nullable().optional();
const date = z.iso.date().nullable().optional();

const itemFields = {
  pageUrl: z.url({ protocol: /^https?$/, error: 'Enter a full http(s) page address.' }).max(500),
  topic: text(200),
  targetQuery: optText(300),
  categoryKey: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  baselineObservation: optText(2000),
  requiredChange: optText(2000),
  ownerStaffId: z.uuid().nullable().optional(),
  dueOn: date,
  measurementSource: optText(300),
  observationOn: date,
};
const checkKeys = z.array(z.enum(OPTIMISATION_CHECK_KEYS)).max(OPTIMISATION_CHECK_KEYS.length);

/** `checks`: which of the example checks apply to this item. */
export const optimisationCreateBody = z
  .object({ ...itemFields, checks: checkKeys.default([]) })
  .strict();
export const optimisationUpdateBody = z
  .object({
    ...itemFields,
    checks: checkKeys,
    evidence: optText(4000),
    /** Ticked checks (keys of this item's checklist). */
    done: checkKeys,
  })
  .partial()
  .strict();
export const optimisationReviewBody = z
  .object({ decision: z.enum(['approved', 'changes_requested']), note: optText(2000) })
  .strict();
export const observationBody = z
  .object({
    platform: text(80),
    query: text(300),
    observedOn: z.iso.date().refine((d) => d <= toIsoDate(), 'The date cannot be in the future.'),
    result: text(2000),
    note: optText(1000),
  })
  .strict();
export const optimisationListQuery = z.object({
  category: z.string().max(40).optional(),
  state: z.enum(MARKETING_REVIEW_STATES).optional(),
});

/** Configured categories with their meaning (none until the reference seed runs). */
export const listOptimisationCategories = (db: Database) =>
  db
    .select({ key: categories.key, label: categories.label, meaning: categories.meaning })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.label));

const owner = staffMembers;
const listFields = {
  id: items.id,
  pageUrl: items.pageUrl,
  topic: items.topic,
  categoryKey: items.categoryKey,
  categoryLabel: categories.label,
  ownerStaffId: items.ownerStaffId,
  ownerName: owner.fullName,
  dueOn: items.dueOn,
  reviewState: items.reviewState,
  evidence: items.evidence,
  checklist: items.checklist,
  isSample: items.isSample,
  updatedAt: items.updatedAt,
};

export async function listOptimisationItems(
  db: Database,
  filter: z.output<typeof optimisationListQuery> & { ownerStaffId?: string; where?: SQL } = {},
) {
  return db
    .select(listFields)
    .from(items)
    .innerJoin(categories, eq(categories.key, items.categoryKey))
    .leftJoin(owner, eq(owner.id, items.ownerStaffId))
    .where(
      and(
        filter.category ? eq(items.categoryKey, filter.category) : undefined,
        filter.state ? eq(items.reviewState, filter.state) : undefined,
        filter.ownerStaffId ? eq(items.ownerStaffId, filter.ownerStaffId as never) : undefined,
        filter.where,
      ),
    )
    .orderBy(asc(items.dueOn), desc(items.updatedAt))
    .limit(500);
}

/** One item with its owner, category and observations (newest first). */
export async function getOptimisationItem(db: Database, id: string) {
  const [found] = await db
    .select({ item: items, ownerName: owner.fullName, categoryLabel: categories.label })
    .from(items)
    .innerJoin(categories, eq(categories.key, items.categoryKey))
    .leftJoin(owner, eq(owner.id, items.ownerStaffId))
    .where(eq(items.id, id as never));
  if (!found) throw new NotFoundError('SEO/AIO/GEO item not found.');
  const log = await db
    .select({
      id: observations.id,
      platform: observations.platform,
      query: observations.query,
      observedOn: observations.observedOn,
      result: observations.result,
      source: observations.source,
      note: observations.note,
      recordedByName: users.displayName,
    })
    .from(observations)
    .leftJoin(users, eq(users.id, observations.recordedBy))
    .where(eq(observations.itemId, found.item.id))
    .orderBy(desc(observations.observedOn), desc(observations.createdAt));
  return {
    ...found.item,
    ownerName: found.ownerName,
    categoryLabel: found.categoryLabel,
    observations: log,
  };
}

/** The item is the actor's: they created it or own it (no self-review; own write scope). */
export const isMine = async (db: Database, actor: Actor, item: Item) => {
  if (item.createdBy === actor.id) return true;
  const staffId = await myStaffId(db, actor.id);
  return staffId !== null && item.ownerStaffId === staffId;
};

/** Write permission plus own scope: employees change only their own items (403 otherwise). */
async function assertWritable(db: Database, actor: Actor, item: Item) {
  assertCan(actor, 'marketing:optimisation:write');
  if (scopeFor(actor, 'marketing:optimisation:write') === 'all') return;
  if (!(await isMine(db, actor, item)))
    throw new ForbiddenError('You can change only SEO/AIO/GEO work that you own or created.');
}

/** Managers may give an item to any active Marketing & Growth person; employees only to themselves. */
async function resolveOwner(db: Database, actor: Actor, requested: string | null | undefined) {
  const mine = await myStaffId(db, actor.id);
  if (requested === undefined || requested === mine) return mine;
  if (scopeFor(actor, 'marketing:optimisation:write') !== 'all')
    throw new ForbiddenError('Only a marketing manager can give work to someone else.');
  if (requested === null) return null;
  const [person] = await memberOptions(db, requested);
  if (!person) throw new ValidationError('Choose an active Marketing & Growth staff member.');
  return person.id;
}

async function assertCategory(db: Database, key: string) {
  const [row] = await db
    .select({ key: categories.key })
    .from(categories)
    .where(and(eq(categories.key, key), eq(categories.active, true)));
  if (!row) throw new ValidationError('Choose a configured category.');
}

export async function createOptimisationItem(
  db: Database,
  actor: Actor,
  input: z.output<typeof optimisationCreateBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:optimisation:write');
  const { checks, ownerStaffId, ...fields } = input;
  await assertCategory(db, fields.categoryKey);
  const ownerId = await resolveOwner(db, actor, ownerStaffId);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(items)
      .values({
        ...fields,
        ownerStaffId: ownerId,
        checklist: buildChecklist(checks),
        createdBy: actor.id,
      })
      .returning();
    await auditMarketing(tx, actor, {
      action: 'optimisation_item.created',
      entityType: 'optimisation_item',
      entityId: row!.id,
      after: row,
      requestId,
    });
    return row!;
  });
}

export async function updateOptimisationItem(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof optimisationUpdateBody>,
  requestId?: string,
) {
  const { checks, done, ownerStaffId, ...fields } = input;
  if (fields.categoryKey) await assertCategory(db, fields.categoryKey);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, items, id, 'SEO/AIO/GEO item not found.', true);
    await assertWritable(tx, actor, before);
    if (!isEditable(before.reviewState))
      throw new InvalidStateTransitionError(
        before.reviewState === 'approved'
          ? 'This work is approved and can no longer change. Start a new item for further work.'
          : 'This work is waiting for review. It can change again if changes are requested.',
      );
    const keys = checks ?? before.checklist.map((c) => c.key);
    const ticked = done ?? before.checklist.filter((c) => c.done).map((c) => c.key);
    const [after] = await tx
      .update(items)
      .set({
        ...fields,
        ...(ownerStaffId !== undefined
          ? { ownerStaffId: await resolveOwner(tx, actor, ownerStaffId) }
          : {}),
        checklist: buildChecklist(keys, ticked),
      })
      .where(eq(items.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'optimisation_item.updated',
      entityType: 'optimisation_item',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

export async function submitOptimisationItem(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, items, id, 'SEO/AIO/GEO item not found.', true);
    await assertWritable(tx, actor, before);
    if (!isEditable(before.reviewState))
      throw new InvalidStateTransitionError('Only a draft or an item sent back can be submitted.');
    if (!before.evidence?.trim())
      throw new ValidationError(
        'Add evidence of the work (a link, a screenshot reference or a short note) before submitting.',
      );
    return transition(tx, actor, before, { reviewState: 'submitted' }, requestId);
  });
}

/** Approve or ask for changes: needs marketing:optimisation:review and never on your own work. */
export async function reviewOptimisationItem(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof optimisationReviewBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:optimisation:review');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, items, id, 'SEO/AIO/GEO item not found.', true);
    if ((await isMine(tx, actor, before)) || (await wroteEvidence(tx, actor, before.id)))
      throw new ForbiddenError(
        'Another reviewer must review work you own, created or wrote the evidence for.',
      );
    if (before.reviewState !== 'submitted')
      throw new InvalidStateTransitionError('Only submitted work can be reviewed.');
    if (input.decision === 'changes_requested' && !input.note)
      throw new ValidationError('Say what needs to change.');
    return transition(
      tx,
      actor,
      before,
      { reviewState: input.decision, reviewNote: input.note ?? before.reviewNote },
      requestId,
    );
  });
}

/** True when the actor ever changed this item's evidence (from its audit trail). */
export async function wroteEvidence(db: Database, actor: Actor, itemId: string) {
  const edits = await db
    .select({ before: auditEvents.before, after: auditEvents.after })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, 'optimisation_item'),
        eq(auditEvents.entityId, itemId),
        eq(auditEvents.action, 'optimisation_item.updated'),
        eq(auditEvents.actorUserId, actor.id),
      ),
    );
  const evidence = (v: unknown) => (v as { evidence?: string | null } | null)?.evidence ?? null;
  return edits.some((e) => evidence(e.before) !== evidence(e.after));
}

async function transition(
  tx: Database,
  actor: Actor,
  before: Item,
  set: { reviewState: ReviewState; reviewNote?: string | null },
  requestId?: string,
) {
  const [after] = await tx.update(items).set(set).where(eq(items.id, before.id)).returning();
  await auditMarketing(tx, actor, {
    action: `optimisation_item.${set.reviewState}`,
    entityType: 'optimisation_item',
    entityId: before.id,
    before: { reviewState: before.reviewState },
    after: set,
    requestId,
  });
  return after!;
}

/** Append a manual observation (source is always `manual`: no analytics is connected). */
export async function addObservation(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof observationBody>,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const item = await rowById(tx, items, itemId, 'SEO/AIO/GEO item not found.');
    await assertWritable(tx, actor, item);
    const [row] = await tx
      .insert(observations)
      .values({ ...input, itemId: item.id, source: 'manual', recordedBy: actor.id })
      .returning();
    await auditMarketing(tx, actor, {
      action: 'optimisation_observation.recorded',
      entityType: 'optimisation_item',
      entityId: item.id,
      after: row,
      requestId,
    });
    return row!;
  });
}
