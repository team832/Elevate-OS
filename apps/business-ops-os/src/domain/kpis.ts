/**
 * Management-dashboard KPI aggregation (OPS-024). Pure: callers pass plain rows.
 * Definitions: docs/KPI_DEFINITIONS.md; algorithm: docs/ALGORITHMS.md → A-12.
 *
 * MISSING IS NOT ZERO. A rate whose denominator is 0 is `missing` (with a
 * reason), never 0 %. A cohort whose window has not elapsed is `missing`.
 * Counts from Ops' own complete tables are `ok`, and a real 0 shows as 0.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, daysBetween, istToday, windowLabel, type IsoDate } from './dates';

export interface KpiWindow {
  from: IsoDate;
  to: IsoDate;
}

const pct = (num: number, den: number) => Math.round((num / den) * 1000) / 10;
const inWindow = (d: IsoDate, w: KpiWindow) => d >= w.from && d <= w.to;
const meta = (definition: string, w: KpiWindow, unit: Metric['unit'], label?: string) => ({
  definition,
  window: { from: w.from, to: w.to, label: label ?? windowLabel(w.from, w.to) },
  unit,
});
/** Point-in-time metadata: the window is today (IST). */
const asOfMeta = (definition: string, asOf: Date, unit: Metric['unit']) => {
  const today = istToday(asOf);
  return meta(definition, { from: today, to: today }, unit, `As of ${windowLabel(today, today)}`);
};

// --- K-01 new leads ------------------------------------------------------------------------------

export interface LeadKpiRow {
  receivedAt: Date;
  merged: boolean;
  /** First time the lead's admission reached `admitted` (BR-OPS-6 confirmed admission). */
  admittedAt: Date | null;
}

export function newLeads(leads: readonly LeadKpiRow[], window: KpiWindow): Metric {
  const n = leads.filter((l) => !l.merged && inWindow(istToday(l.receivedAt), window)).length;
  return metric.ok(
    n,
    meta(
      'Leads received in the window (Asia/Kolkata dates), excluding leads merged as duplicates.',
      window,
      'count',
    ),
  );
}

// --- lead → admission conversion (cohort, BR-OPS-8) ---------------------------------------------

/**
 * Cohort conversion: of the leads RECEIVED in the cohort window, the share
 * admitted within `windowDays` days of receipt. Never "this week's admissions ÷
 * this week's leads" (BR-OPS-8).
 */
export function leadToAdmissionConversion(
  leads: readonly LeadKpiRow[],
  cohort: KpiWindow,
  windowDays: number,
  asOf: Date,
): Metric {
  const m = meta(
    `Leads received in the cohort window that reached "admitted" within ${windowDays} days of receipt ÷ leads received in the cohort window (merged duplicates excluded).`,
    cohort,
    'percent',
    `Cohort ${windowLabel(cohort.from, cohort.to)}, ${windowDays}-day window`,
  );
  const today = istToday(asOf);
  if (daysBetween(cohort.to, today) < windowDays) {
    return metric.missing(
      `Window not elapsed: available from ${addDays(cohort.to, windowDays)} (cohort end + ${windowDays} days).`,
      m,
    );
  }
  const cohortLeads = leads.filter((l) => !l.merged && inWindow(istToday(l.receivedAt), cohort));
  if (cohortLeads.length === 0)
    return metric.missing('No leads were received in the cohort window.', m);
  const converted = cohortLeads.filter(
    (l) =>
      l.admittedAt && daysBetween(istToday(l.receivedAt), istToday(l.admittedAt)) <= windowDays,
  ).length;
  return metric.ok(pct(converted, cohortLeads.length), m);
}

/** The latest Monday–Sunday cohort week whose N-day window has fully elapsed by `asOf`. */
export function latestElapsedCohortWeek(asOf: Date, windowDays: number): KpiWindow {
  const today = istToday(asOf);
  const lastEligibleEnd = addDays(today, -windowDays);
  // Sunday on or before lastEligibleEnd.
  const [y, mo, d] = lastEligibleEnd.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const to = addDays(lastEligibleEnd, -weekday);
  return { from: addDays(to, -6), to };
}

// --- follow-up compliance ------------------------------------------------------------------------

export interface FollowUpKpiRow {
  kind: string;
  dueDate: IsoDate;
  status: 'open' | 'done' | 'cancelled';
  completedAt: Date | null;
}

/**
 * Counselling and demo follow-ups due in the window (and whose due date has
 * passed by as-of) that were completed on or before their due date ÷ those due.
 */
export function followUpCompliance(
  rows: readonly FollowUpKpiRow[],
  window: KpiWindow,
  asOf: Date,
): Metric {
  const today = istToday(asOf);
  const m = meta(
    'Counselling and demo follow-ups due in the window (due date already passed) completed on or before the due date ÷ such follow-ups due. Cancelled follow-ups are excluded.',
    window,
    'percent',
  );
  const due = rows.filter(
    (r) =>
      (r.kind === 'counselling_followup' || r.kind === 'demo_followup') &&
      r.status !== 'cancelled' &&
      inWindow(r.dueDate, window) &&
      r.dueDate < today,
  );
  if (due.length === 0)
    return metric.missing(
      'No counselling or demo follow-ups fell due (and passed) in the window.',
      m,
    );
  const onTime = due.filter(
    (r) => r.status === 'done' && r.completedAt && istToday(r.completedAt) <= r.dueDate,
  ).length;
  return metric.ok(pct(onTime, due.length), m);
}

// --- overdue work --------------------------------------------------------------------------------

/** A point-in-time count from Ops' own complete tables (a real 0 is 0). */
export function pointCount(n: number, definition: string, asOf: Date): Metric {
  return metric.ok(n, asOfMeta(definition, asOf, 'count'));
}

/** Open follow-ups whose due date is before today (IST). Point in time. */
export function overdueWork(followUps: readonly FollowUpKpiRow[], asOf: Date): Metric {
  const today = istToday(asOf);
  return pointCount(
    followUps.filter((r) => r.status === 'open' && r.dueDate < today).length,
    'Open follow-ups whose due date (Asia/Kolkata) is before today. Point in time.',
    asOf,
  );
}
