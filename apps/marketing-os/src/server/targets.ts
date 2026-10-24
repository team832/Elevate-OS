/**
 * Marketing targets (brief 23 Oct 2026 §15): managers set them by employee, team or campaign
 * and period; actuals come from the records per metric in target-records.ts.
 * Read scope (marketing:targets:read own): your employee targets, team targets and targets of
 * campaigns you are a current member of; anything else reads as not found.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { scopeFor } from '@elevate/authorization';
import {
  MARKETING_TARGET_METRIC_KEYS,
  MARKETING_TARGET_SCOPES,
  isUniqueViolation,
  marketingCampaignMembers as members,
  marketingCampaigns as campaigns,
  marketingTargets as targets,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import {
  toIsoDate,
  type CampaignId,
  type IsoDate,
  type StaffMemberId,
} from '@elevate/shared-types';
import { remainingOf } from '../domain/metrics';
import { assertCan, type Actor } from './access';
import { memberOptions } from './campaign-members';
import { auditMarketing, rowById } from './common';
import { myStaffId } from './scope';

import { METRIC_RECORDS, actualOf, type MetricFilter } from './target-records';

export {
  METRIC_RECORDS,
  actualOf,
  admissionAttribution,
  type MetricFilter,
  type MetricRecord,
  type MetricRecords,
} from './target-records';

const text = z.string().trim().min(1).max(500).nullable().optional();
const period = { periodStart: z.iso.date(), periodEnd: z.iso.date() };
const periodOrder = (t: { periodStart?: string; periodEnd?: string }) =>
  !t.periodStart || !t.periodEnd || t.periodStart <= t.periodEnd;

export const targetBody = z
  .object({
    scope: z.enum(MARKETING_TARGET_SCOPES),
    staffId: z.uuid().nullable().optional(),
    campaignId: z.uuid().nullable().optional(),
    ...period,
    metricKey: z.enum(MARKETING_TARGET_METRIC_KEYS),
    targetValue: z.number().int().positive().max(100_000),
    note: text,
  })
  .strict()
  .refine(periodOrder, { error: 'The period must end on or after its start.', path: ['periodEnd'] })
  .refine((t) => (t.scope === 'employee') === Boolean(t.staffId), {
    error: 'An employee target needs the employee, and only an employee target has one.',
    path: ['staffId'],
  })
  .refine((t) => (t.scope === 'campaign') === Boolean(t.campaignId), {
    error: 'A campaign target needs the campaign, and only a campaign target has one.',
    path: ['campaignId'],
  });

/** Who, metric and scope are the target's identity: change them by removing and adding. */
export const targetUpdateBody = z
  .object({
    ...period,
    targetValue: z.number().int().positive().max(100_000),
    note: text,
  })
  .partial()
  .strict()
  .refine(periodOrder, {
    error: 'The period must end on or after its start.',
    path: ['periodEnd'],
  });

export const targetListQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  scope: z.enum(MARKETING_TARGET_SCOPES).optional(),
  staffId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
});
export type TargetListFilter = z.output<typeof targetListQuery>;

async function visibleTargets(db: Database, actor: Actor): Promise<SQL | undefined> {
  if (scopeFor(actor, 'marketing:targets:read') === 'all') return undefined;
  const staffId = await myStaffId(db, actor.id);
  if (!staffId) return eq(targets.scope, 'team');
  const mine = db
    .select({ id: members.campaignId })
    .from(members)
    .where(
      and(
        eq(members.staffId, staffId),
        or(isNull(members.toDate), gte(members.toDate, toIsoDate())),
      ),
    );
  return or(
    eq(targets.scope, 'team'),
    eq(targets.staffId, staffId),
    inArray(targets.campaignId, mine),
  );
}

const targetFields = {
  target: targets,
  staffName: staffMembers.fullName,
  campaignCode: campaigns.code,
  campaignName: campaigns.name,
};

/**
 * Targets whose period overlaps from..to (and match the filter), each with its actual over the
 * target's own period and what remains. Export for the dashboard: target vs actual.
 */
export async function targetVsActual(db: Database, actor: Actor, q: TargetListFilter = {}) {
  assertCan(actor, 'marketing:targets:read');
  const rows = await db
    .select(targetFields)
    .from(targets)
    .leftJoin(staffMembers, eq(staffMembers.id, targets.staffId))
    .leftJoin(campaigns, eq(campaigns.id, targets.campaignId))
    .where(
      and(
        await visibleTargets(db, actor),
        q.to ? lte(targets.periodStart, q.to) : undefined,
        q.from ? gte(targets.periodEnd, q.from) : undefined,
        q.scope ? eq(targets.scope, q.scope) : undefined,
        q.staffId ? eq(targets.staffId, q.staffId as never) : undefined,
        q.campaignId ? eq(targets.campaignId, q.campaignId as never) : undefined,
      ),
    )
    .orderBy(desc(targets.periodStart), asc(targets.metricKey))
    .limit(300);
  const out = [];
  for (const r of rows) out.push({ ...r, ...(await targetActual(db, actor, r.target)) });
  return out;
}
export type TargetVsActualRow = Awaited<ReturnType<typeof targetVsActual>>[number];

/** A target's actual (over its own period, up to `cutoff`), its records and what remains. */
export async function targetActual(
  db: Database,
  actor: Actor,
  t: typeof targets.$inferSelect,
  cutoff?: Date,
) {
  const f: MetricFilter = {
    scope: t.scope,
    staffId: t.staffId,
    campaignId: t.campaignId,
    from: t.periodStart as IsoDate,
    to: t.periodEnd as IsoDate,
    cutoff,
  };
  const records = await METRIC_RECORDS[t.metricKey](db, actor, f);
  const actual = actualOf(t.metricKey, f, records);
  return { records, actual, remaining: remainingOf(t.targetValue, actual.value) };
}

/** One target with the records behind its actual and the remaining target (404 out of scope). */
export async function targetDrilldown(db: Database, actor: Actor, id: string, cutoff?: Date) {
  assertCan(actor, 'marketing:targets:read');
  const [row] = await db
    .select(targetFields)
    .from(targets)
    .leftJoin(staffMembers, eq(staffMembers.id, targets.staffId))
    .leftJoin(campaigns, eq(campaigns.id, targets.campaignId))
    .where(and(eq(targets.id, id as never), await visibleTargets(db, actor)));
  if (!row) throw new NotFoundError('Target not found.');
  return { ...row, ...(await targetActual(db, actor, row.target, cutoff)) };
}

export async function createTarget(
  db: Database,
  actor: Actor,
  input: z.output<typeof targetBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:targets:manage');
  if (input.staffId && !(await memberOptions(db, input.staffId)).length)
    throw new ValidationError('Choose an active Marketing & Growth staff member.');
  return withTransaction(db, async (tx) => {
    if (input.campaignId) await rowById(tx, campaigns, input.campaignId, 'Campaign not found.');
    try {
      const [row] = await tx
        .insert(targets)
        .values({
          ...input,
          staffId: (input.staffId ?? null) as StaffMemberId | null,
          campaignId: (input.campaignId ?? null) as CampaignId | null,
          createdBy: actor.id,
        })
        .returning();
      await audit(tx, actor, row!.id, 'created', { after: row }, requestId);
      return row!;
    } catch (error) {
      if (isUniqueViolation(error, 'targets_identity_key'))
        throw new ConflictError('This target already exists for that period. Change it instead.');
      throw error;
    }
  });
}

export async function updateTarget(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof targetUpdateBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:targets:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, targets, id, 'Target not found.', true);
    if ((input.periodStart ?? before.periodStart) > (input.periodEnd ?? before.periodEnd))
      throw new ValidationError('The period must end on or after its start.');
    try {
      const [after] = await tx
        .update(targets)
        .set(input)
        .where(eq(targets.id, before.id))
        .returning();
      await audit(tx, actor, before.id, 'updated', { before, after }, requestId);
      return after!;
    } catch (error) {
      if (isUniqueViolation(error, 'targets_identity_key'))
        throw new ConflictError('A target for that period already exists.');
      throw error;
    }
  });
}

export async function deleteTarget(db: Database, actor: Actor, id: string, requestId?: string) {
  assertCan(actor, 'marketing:targets:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, targets, id, 'Target not found.', true);
    await tx.delete(targets).where(eq(targets.id, before.id));
    await audit(tx, actor, before.id, 'deleted', { before }, requestId);
    return { id: before.id, deleted: true };
  });
}

const audit = (
  tx: Database,
  actor: Actor,
  id: string,
  verb: string,
  change: { before?: unknown; after?: unknown },
  requestId?: string,
) =>
  auditMarketing(tx, actor, {
    action: `target.${verb}`,
    entityType: 'target',
    entityId: id,
    ...change,
    requestId,
  });
