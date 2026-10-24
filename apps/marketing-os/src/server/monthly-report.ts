/**
 * Marketing facts of a monthly work report (brief 23 Oct 2026 §15): built from canonical records
 * up to a cut-off, in the shape of marketingMonthlySnapshotV1Schema. The report itself (draft,
 * the employee's explanation, submission to the reporting manager, review, versions, PDF/CSV) is the Business Ops
 * monthly work report (ops.eod_reports, period_kind 'month'), which stores this snapshot in its
 * submitted versions through GET /marketing/api/internal/v1/reports/monthly.
 * Lead funnel, calls and follow-ups come from Business Ops' lead service (D-073 entry), read as
 * the given actor; a reader who cannot read leads gets them `missing`, never 0. No spend data
 * exists, so no expenses or cost per outcome.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { loadRoles } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import {
  leadMetricRecords,
  leadStageEntries,
  leadStageFunnel,
  listCalls,
} from '@elevate/business-ops-os/leads';
import {
  marketingCalendarItems as cal,
  marketingCampaignMembers as members,
  marketingCampaigns as campaigns,
  marketingTargets as targets,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError } from '@elevate/server-kit';
import {
  marketingMonthlySnapshotV1Schema,
  metric,
  type MarketingMonthlySnapshotV1,
  type MetricMeta,
} from '@elevate/shared-contracts';
import { toIsoDate, type IsoDate, type UserId } from '@elevate/shared-types';
import { monthRange, periodBounds } from '../domain/metrics';
import { assertCan, type Actor } from './access';
import { myStaffId } from './scope';
import { optimisationWorkAsOf } from './monthly-report-seo';
import { targetActual } from './targets';

export const NO_SPEND_DATA = 'No verified spend data: expenses and cost per outcome are not shown.';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthlyReportQuery = z.object({
  month: z.string().regex(MONTH, 'Use YYYY-MM.').optional(),
  staffId: z.uuid().optional(),
});
export const monthlySnapshotQuery = z.object({
  staffId: z.uuid(),
  month: z.string().regex(MONTH, 'Use YYYY-MM.'),
  cutoffAt: z.iso.datetime({ offset: true }).optional(),
});

const monthLabel = (from: IsoDate) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${from}T00:00:00Z`),
  );

const words = (key: string) => key.replaceAll('_', ' ');

/** The person themselves (their roles): Business Ops asks for their snapshot without a user. */
export async function staffActor(db: Database, staffId: string): Promise<Actor> {
  const [row] = await db
    .select({ userId: staffMembers.userId })
    .from(staffMembers)
    .where(eq(staffMembers.id, staffId as never));
  if (!row) throw new NotFoundError('Staff member not found.');
  return row.userId
    ? { id: row.userId, roles: await loadRoles(db, row.userId) }
    : { id: '00000000-0000-0000-0000-000000000000' as UserId, roles: [] };
}

/** Funnel movement and call / follow-up outcomes of the person's own leads, up to the cut-off. */
async function leadFacts(
  db: Database,
  actor: Actor,
  staffId: string,
  range: { from: IsoDate; to: IsoDate },
  cutoff: Date,
  meta: (definition: string) => MetricMeta,
  reader: Reader,
) {
  const row = (key: string, label: string, count: number | string, definition: string) => ({
    key,
    label,
    count:
      typeof count === 'string'
        ? metric.missing(count, meta(definition))
        : metric.ok(count, meta(definition)),
  });
  if (!can(actor, 'ops:leads:read')) {
    const why =
      reader === 'viewer'
        ? 'You cannot read leads, so no lead facts are shown.'
        : 'This person cannot read leads, so no lead facts are counted.';
    return {
      funnel: [
        row(
          'lead_stages',
          'Leads by stage reached',
          why,
          'Leads first entering each stage in the month.',
        ),
      ],
      callOutcomes: [
        row('calls', 'Calls and follow-ups', why, 'Calls and follow-ups logged in the month.'),
      ],
    };
  }
  const q = { ...range, ownerStaffIds: [staffId], cutoff };
  const stages = await leadStageFunnel(db, actor, q);
  const entries = await leadStageEntries(db, actor, q);
  /** "Qualified (1 with owner from current record (no history))" when credit had no trail. */
  const stageLabel = (key: string, label: string) => {
    const noted = entries.filter((e) => e.stageKey === key && e.ownerNote);
    return noted.length ? `${label} (${noted.length} with ${noted[0]!.ownerNote})` : label;
  };
  // shortcut: listCalls returns at most 500 calls a month; page through it if anyone logs more.
  const calls = (await listCalls(db, actor, { ...range, staffId })).filter(
    (c) => c.occurredAt <= cutoff && c.createdAt <= cutoff,
  );
  const outcomes = [...new Set(calls.map((c) => c.outcome))].sort();
  const followUps = await leadMetricRecords(db, actor, { ...q, metric: 'follow_ups_completed' });
  return {
    funnel: stages.length
      ? stages.map((s) =>
          row(
            s.key,
            stageLabel(s.key, s.label),
            s.count,
            `Leads first entering "${s.label}" in the month.`,
          ),
        )
      : [
          row(
            'lead_stages',
            'Leads by stage reached',
            'No lead stages are configured yet.',
            'Leads first entering each stage in the month.',
          ),
        ],
    callOutcomes: [
      row(
        'calls_logged',
        'Calls logged',
        calls.length,
        'Calls this person logged in the month. A call count is not a sales count.',
      ),
      ...outcomes.map((o) =>
        row(
          `call_${o}`,
          `Calls: ${words(o)}`,
          calls.filter((c) => c.outcome === o).length,
          `Logged calls with the outcome "${words(o)}".`,
        ),
      ),
      row(
        'follow_ups_completed',
        'Follow-ups completed',
        followUps.length,
        'Follow-ups this person marked done with an outcome in the month.',
      ),
    ],
  };
}

/** Who missing-data reasons speak to: the live page's viewer, or (stored) about the person. */
type Reader = 'viewer' | 'person';

/**
 * The snapshot for one person and one IST month, counting only what happened by `cutoffAt`.
 * `actor` reads the Business Ops lead facts (a manager, or the person themselves).
 */
export async function buildMonthlySnapshot(
  db: Database,
  actor: Actor,
  input: { staffId: string; month: string; cutoffAt?: Date; reader?: Reader },
): Promise<MarketingMonthlySnapshotV1> {
  const range = monthRange(input.month);
  if (!range) throw new NotFoundError('Month not found.');
  const cutoff = input.cutoffAt ?? new Date();
  const { start, end } = periodBounds(range.from, range.to, cutoff);
  const meta = (definition: string): MetricMeta => ({
    definition,
    window: { ...range, label: monthLabel(range.from) },
    unit: 'count',
  });
  const staffId = input.staffId as never;
  const within = (c: PgColumn) => and(gte(c, start), lt(c, end));

  const goals = await db
    .select()
    .from(targets)
    .where(
      and(
        eq(targets.scope, 'employee'),
        eq(targets.staffId, staffId),
        lte(targets.periodStart, range.to),
        gte(targets.periodEnd, range.from),
        lte(targets.createdAt, cutoff),
      ),
    )
    .orderBy(asc(targets.metricKey));
  const targetRows = [];
  for (const t of goals) targetRows.push({ t, ...(await targetActual(db, actor, t, cutoff)) });

  const campaignRows = await db
    .selectDistinct({
      id: campaigns.id,
      code: campaigns.code,
      name: campaigns.name,
      isSample: campaigns.isSample,
    })
    .from(members)
    .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
    .where(
      and(
        eq(members.staffId, staffId),
        lte(members.fromDate, range.to),
        or(isNull(members.toDate), gte(members.toDate, range.from)),
      ),
    )
    .orderBy(asc(campaigns.code));
  const campaignIds = campaignRows.map((c) => c.id);
  const items = await db
    .select({
      ownerStaffId: cal.ownerStaffId,
      campaignId: cal.campaignId,
      status: cal.status,
      plannedAt: cal.plannedAt,
      createdAt: cal.createdAt,
      approvedAt: cal.approvedAt,
      publishedAt: cal.publishedAt,
      isSample: cal.isSample,
    })
    .from(cal)
    .where(
      and(
        or(
          eq(cal.ownerStaffId, staffId),
          campaignIds.length ? inArray(cal.campaignId, campaignIds) : undefined,
        ),
        or(within(cal.plannedAt), within(cal.approvedAt), within(cal.publishedAt)),
      ),
    );
  const at = (d: Date | null) => d !== null && d >= start && d < end;
  const counts = (rows: typeof items) => ({
    planned: metric.ok(
      rows.filter((r) => at(r.plannedAt) && r.createdAt <= cutoff && r.status !== 'cancelled')
        .length,
      meta('Calendar items planned for a date in the month (not cancelled).'),
    ),
    approved: metric.ok(
      rows.filter((r) => at(r.approvedAt) && r.status !== 'cancelled').length,
      meta('Calendar items approved in the month (not cancelled since).'),
    ),
    published: metric.ok(
      rows.filter((r) => at(r.publishedAt)).length,
      meta('Calendar items recorded as published in the month, with a link or evidence.'),
    ),
  });

  const work = await optimisationWorkAsOf(db, input.staffId, start, end);

  const mine = items.filter((i) => i.ownerStaffId === input.staffId);
  return marketingMonthlySnapshotV1Schema.parse({
    version: 1,
    cutoffAt: cutoff.toISOString(),
    isSample: [...targetRows.map((r) => r.t), ...campaignRows, ...mine, ...work].some(
      (r) => r.isSample,
    ),
    targets: targetRows.map((r) => ({
      targetId: r.t.id,
      scope: r.t.scope,
      metricKey: r.t.metricKey,
      target: r.t.targetValue,
      actual: r.actual,
    })),
    ...(await leadFacts(db, actor, input.staffId, range, cutoff, meta, input.reader ?? 'person')),
    campaigns: campaignRows.map((c) => ({
      campaignId: c.id,
      code: c.code,
      name: c.name,
      ...counts(items.filter((i) => i.campaignId === c.id)),
    })),
    content: counts(mine),
    optimisation: work.map(({ isSample: _s, ...w }) => w),
  });
}

/**
 * The snapshot for a page or API reader: marketing:reports:read, own scope = only your own
 * report (someone else's reads as not found). Default person = you, default month = this one.
 */
export async function monthlySnapshotFor(
  db: Database,
  actor: Actor,
  q: z.output<typeof monthlyReportQuery>,
) {
  assertCan(actor, 'marketing:reports:read');
  const own = await myStaffId(db, actor.id);
  const staffId = q.staffId ?? own;
  if (!staffId || (scopeFor(actor, 'marketing:reports:read') !== 'all' && staffId !== own))
    throw new NotFoundError(
      own || q.staffId ? 'Report not found.' : 'Your login is not linked to a staff record yet.',
    );
  const month = q.month ?? toIsoDate().slice(0, 7);
  return {
    staffId,
    month,
    snapshot: await buildMonthlySnapshot(db, actor, { staffId, month, reader: 'viewer' }),
  };
}
