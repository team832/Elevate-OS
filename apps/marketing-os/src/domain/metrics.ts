/**
 * Marketing target metrics (brief 23 Oct 2026 §15): the ONE list of what can be a target, what
 * each counts and where the count comes from. Screens, the targets service, the drill-down and
 * the monthly report all read these definitions. Actuals are never stored (SCHEMA-CONTRACT-MKT).
 * A call count is deliberately not a metric: many calls are not a sale.
 */
import { addDays, type IsoDate } from '@elevate/shared-types';
import { istMidnightUtc } from './week';

export type MetricSource = 'marketing' | 'ops';

export interface TargetMetricDefinition {
  label: string;
  /** Unit word for "12 leads". */
  unit: string;
  source: MetricSource;
  /** Where the records are, in words. */
  sourceLabel: string;
  definition: string;
}

export const TARGET_METRICS = {
  qualified_leads: {
    label: 'Qualified leads',
    unit: 'leads',
    source: 'ops',
    sourceLabel: 'Business Operations: lead stage history',
    definition:
      'Leads owned by the person (or the team) that entered the "Qualified" stage during the period. A lead counts once.',
  },
  follow_ups_completed: {
    label: 'Follow-ups completed',
    unit: 'follow-ups',
    source: 'ops',
    sourceLabel: 'Business Operations: follow-ups',
    definition:
      'Follow-ups marked done with an outcome during the period, by their owner. A logged call alone is not a completed follow-up.',
  },
  demo_bookings: {
    label: 'Demo bookings',
    unit: 'leads',
    source: 'ops',
    sourceLabel: 'Business Operations: lead stage history',
    definition:
      'Leads owned by the person (or the team) that entered the "Demo booked" stage during the period.',
  },
  verified_admissions: {
    label: 'Verified admissions',
    unit: 'admissions',
    source: 'ops',
    sourceLabel: 'Business Operations: confirmed admissions linked to leads',
    definition:
      'Admissions that Business Operations confirmed during the period, credited by the admission credit rule below. A lead marked converted without a confirmed admission does not count.',
  },
  approved_content: {
    label: 'Approved content',
    unit: 'items',
    source: 'marketing',
    sourceLabel: 'Marketing calendar: approval date',
    definition:
      'Calendar items approved during the period and not cancelled since, by their owner (or in the campaign).',
  },
  published_content: {
    label: 'Published content',
    unit: 'items',
    source: 'marketing',
    sourceLabel: 'Marketing calendar: publication date with a link or evidence',
    definition:
      'Calendar items recorded as published during the period. Every one has a public link or written publication evidence.',
  },
  campaign_deliverables: {
    label: 'Campaign deliverables',
    unit: 'items',
    source: 'marketing',
    sourceLabel: 'Marketing calendar: items linked to a campaign',
    definition:
      'Calendar items linked to a campaign that were approved during the period and are approved, scheduled or published now.',
  },
} as const satisfies Record<string, TargetMetricDefinition>;

export type TargetMetricKey = keyof typeof TARGET_METRICS;
export const TARGET_METRIC_KEYS = Object.keys(TARGET_METRICS) as TargetMetricKey[];

export const TARGET_SCOPE_LABELS = {
  employee: 'Employee',
  team: 'Marketing team',
  campaign: 'Campaign',
} as const;

/** Words for each value of the setting marketing.targets.admission_attribution (server/policy.ts). */
export const ADMISSION_CREDIT_LABELS: Record<string, string> = {
  lead_owner_at_confirmation:
    'The lead owner at the moment Business Operations confirmed the admission',
};

export const NO_CALL_TARGET =
  'Call counts are not a target: a high number of calls does not mean admissions.';

/** UTC instants bounding the IST days `from`..`to`, cut at `cutoff` when earlier. */
export function periodBounds(from: IsoDate, to: IsoDate, cutoff?: Date) {
  const end = istMidnightUtc(addDays(to, 1));
  return { start: istMidnightUtc(from), end: cutoff && cutoff < end ? cutoff : end };
}

/** First and last day of a `YYYY-MM` month, or null when malformed. */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return {
    from: `${month}-01` as IsoDate,
    to: `${month}-${String(last).padStart(2, '0')}` as IsoDate,
  };
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "5 Oct 2026" for a calendar date; "Not set" when there is none. */
export const formatDay = (d: string | null | undefined) =>
  d ? dayFormat.format(new Date(`${d}T00:00:00Z`)) : 'Not set';
export const formatPeriod = (from: string, to: string) => `${formatDay(from)} to ${formatDay(to)}`;

/** Remaining to reach the target; null when the actual is not available (never "all of it"). */
export const remainingOf = (target: number, actual: number | null) =>
  actual === null ? null : Math.max(target - actual, 0);
