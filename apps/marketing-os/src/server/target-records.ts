/**
 * The records behind each marketing target metric (brief 23 Oct 2026 §15): ONE records function
 * per metric (METRIC_RECORDS), used by both the chart and the drill-down, so they always agree.
 * A metric whose records cannot be read is `missing` ("Not available"), never 0.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, type SQL } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import { leadMetricRecords, type LeadMetric } from '@elevate/business-ops-os/leads';
import {
  departments,
  marketingCalendarItems as cal,
  staffMembers,
  type Database,
  type MARKETING_TARGET_METRIC_KEYS,
  type MARKETING_TARGET_SCOPES,
} from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import { MODULE, modulePath } from '../domain';
import { TARGET_METRICS, periodBounds, type TargetMetricKey } from '../domain/metrics';
import type { Actor } from './access';
import { POLICY_DEFINITIONS, listPolicySettings } from './policy';
import { myStaffId } from './scope';

export type Scope = (typeof MARKETING_TARGET_SCOPES)[number];
// Compile-time check: the domain list and the database vocabulary are the same seven keys.
const _sameKeys: Record<(typeof MARKETING_TARGET_METRIC_KEYS)[number], unknown> &
  Record<TargetMetricKey, unknown> = TARGET_METRICS;
void _sameKeys;

export interface MetricFilter {
  scope: Scope;
  staffId: string | null;
  campaignId: string | null;
  from: IsoDate;
  to: IsoDate;
  /** Count only what had happened by this instant (a report's cut-off). */
  cutoff?: Date;
}
export interface MetricRecord {
  id: string;
  title: string;
  at: Date;
  /** Null: a lead the reader may no longer open (title "Lead now with another owner"). */
  href: string | null;
  /** Unknown for Business Ops records (they carry no flag here). */
  isSample?: boolean;
  /** e.g. "owner from current record (no history)" on a lead with no ownership trail. */
  note?: string;
}
export type MetricRecords =
  { status: 'ok'; rows: MetricRecord[] } | { status: 'missing'; reason: string };

const missing = (reason: string): MetricRecords => ({ status: 'missing', reason });

/** Everyone in Marketing & Growth (also people who left: their leads still count for the team). */
const marketingStaffIds = async (db: Database) =>
  (
    await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .innerJoin(departments, eq(departments.id, staffMembers.departmentId))
      .where(eq(departments.code, 'MARKETING_GROWTH'))
  ).map((r) => r.id as string);

/**
 * Lead, follow-up and admission records from Business Ops (leadMetricRecords, D-073 entry), read
 * as the viewer. Someone who may read only their own leads sees lead actuals of their own
 * employee targets only; team actuals would otherwise count fewer leads than a manager sees.
 */
const leadRecords =
  (metric: LeadMetric) =>
  async (db: Database, actor: Actor, f: MetricFilter): Promise<MetricRecords> => {
    if (f.scope === 'campaign')
      return missing(
        'Leads are not credited to campaigns, so a campaign lead target cannot be counted.',
      );
    if (!can(actor, 'ops:leads:read')) return missing('Your role cannot read leads.');
    if (
      scopeFor(actor, 'ops:leads:read') !== 'all' &&
      !(f.scope === 'employee' && f.staffId === (await myStaffId(db, actor.id)))
    )
      return missing('Counted for marketing managers: you can read only your own leads.');
    const rows = await leadMetricRecords(db, actor, {
      metric,
      ownerStaffIds: f.scope === 'employee' ? [f.staffId!] : await marketingStaffIds(db),
      from: f.from,
      to: f.to,
      cutoff: f.cutoff,
      attribution: (await admissionAttribution(db)).value,
      base: MODULE.basePath,
    });
    return {
      status: 'ok',
      rows: rows.map(({ ownerNote, ...r }) => (ownerNote ? { ...r, note: ownerNote } : r)),
    };
  };

/** Calendar items whose `column` falls in the period, for the target's person, campaign or team. */
const calendarRecords =
  (column: 'approvedAt' | 'publishedAt', extra?: SQL) =>
  async (db: Database, _actor: Actor, f: MetricFilter): Promise<MetricRecords> => {
    const { start, end } = periodBounds(f.from, f.to, f.cutoff);
    const rows = await db
      .select({ id: cal.id, title: cal.title, at: cal[column], isSample: cal.isSample })
      .from(cal)
      .where(
        and(
          gte(cal[column], start),
          lt(cal[column], end),
          f.scope === 'employee' ? eq(cal.ownerStaffId, f.staffId as never) : undefined,
          f.scope === 'campaign' ? eq(cal.campaignId, f.campaignId as never) : undefined,
          extra,
        ),
      )
      .orderBy(asc(cal[column]));
    return {
      status: 'ok',
      rows: rows.map((r) => ({ ...r, at: r.at!, href: modulePath(`calendar?open=${r.id}`) })),
    };
  };

/** THE records behind each metric (chart actual = drill-down rows). */
export const METRIC_RECORDS: Record<
  TargetMetricKey,
  (db: Database, actor: Actor, f: MetricFilter) => Promise<MetricRecords>
> = {
  qualified_leads: leadRecords('qualified_leads'),
  follow_ups_completed: leadRecords('follow_ups_completed'),
  demo_bookings: leadRecords('demo_bookings'),
  verified_admissions: leadRecords('verified_admissions'),
  approved_content: calendarRecords('approvedAt', ne(cal.status, 'cancelled')),
  published_content: calendarRecords('publishedAt'),
  campaign_deliverables: calendarRecords(
    'approvedAt',
    and(isNotNull(cal.campaignId), inArray(cal.status, ['approved', 'scheduled', 'published'])),
  ),
};

/** The admission credit rule (setting marketing.targets.admission_attribution) and its status. */
export async function admissionAttribution(db: Database) {
  const d = POLICY_DEFINITIONS.admissionAttribution;
  const stored = (await listPolicySettings(db)).find((x) => x.key === d.key)!;
  const valid = d.schema.safeParse(stored.value);
  // An invalid stored value never counts: the proposed default applies until it is fixed.
  return valid.success
    ? { key: d.key, value: valid.data, status: stored.status }
    : { key: d.key, value: d.defaultValue, status: d.status };
}

/** The metric value of a records result (missing stays missing). */
export function actualOf(key: TargetMetricKey, f: MetricFilter, r: MetricRecords): Metric {
  const meta = {
    definition: TARGET_METRICS[key].definition,
    window: { from: f.from, to: f.to },
    unit: 'count' as const,
  };
  return r.status === 'ok' ? metric.ok(r.rows.length, meta) : metric.missing(r.reason, meta);
}
