/**
 * Admissions overview KPIs (owner brief 21 Oct 2026 §4) and the window helpers every admissions
 * KPI shares (re-exported by ./admissions-kpis.ts). Pure; missing is not zero.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { daysBetween, istToday, windowLabel } from './dates';
import type { KpiWindow } from './kpis';
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from './applications';
import { demoProgress, sessionsInRange } from './demos';
import type { PlanTotals } from './fee-plans';
import {
  effectiveRecords,
  FEE_CHARGE_CATEGORIES,
  ledgerSums,
  type FeeChargeCategory,
  type FeeRecordLike,
} from './fees';
import { isOnboardingOverdue, type OnboardingStatus } from './onboarding';

export const inWindow = (d: string, w: KpiWindow) => d >= w.from && d <= w.to;
export const pct = (num: number, den: number) => Math.round((num / den) * 1000) / 10;
export const meta = (definition: string, w: KpiWindow, unit: Metric['unit'], label?: string) => ({
  definition,
  window: { from: w.from, to: w.to, label: label ?? windowLabel(w.from, w.to) },
  unit,
});
export const pointInTime = (asOf: Date): KpiWindow => {
  const d = istToday(asOf);
  return { from: d, to: d };
};
/** A point-in-time count ("As of today" / "As of now"). */
export const pointCount = (asOf: Date, label: string) => (n: number, definition: string) =>
  metric.ok(n, meta(definition, pointInTime(asOf), 'count', label));

type DaySession = Parameters<typeof demoProgress>[0][number];

export interface OverviewDemoRow {
  plannedDayCount: number;
  sessions: readonly DaySession[];
  /** When the demo's admission was confirmed (its admission approval); null = not (yet). */
  confirmedAt: Date | null;
}

/**
 * Demos with a class in the window (the demo list's date rule) and their progress in DAYS
 * (D-1: a day counts once when one of its classes was attended; classes are not days).
 */
export function demoDayProgress(rows: readonly OverviewDemoRow[], window: KpiWindow) {
  const progress = rows
    .filter((r) => sessionsInRange(r.sessions, window.from, window.to))
    .map((r) => demoProgress(r.sessions, r.plannedDayCount));
  const sum = (k: 'attended' | 'planned') => progress.reduce((n, p) => n + p[k], 0);
  const m = meta(
    'Demo days attended by demos with a class in the window: a day counts once when at least one of its classes was attended (present or late). Classes are not days.',
    window,
    'count',
  );
  return {
    demos: progress.length,
    plannedDays: sum('planned'),
    allDaysAttended: progress.filter((p) => p.attended >= p.planned).length,
    daysAttended: progress.length
      ? metric.ok(sum('attended'), m)
      : metric.missing('No demo had a class in the window.', m),
  };
}

/** IST date of the demo's earliest class that was not cancelled; null when none. */
const firstDemoDay = (sessions: readonly DaySession[]) => {
  const live = sessions.filter((s) => s.attendance !== 'cancelled');
  return live.length ? istToday(new Date(Math.min(...live.map((s) => +s.startsAt)))) : null;
};

/**
 * Demo → admission conversion. Cohort = demos whose first demo day is in the window AND whose
 * `windowDays` have passed; converted = admission confirmed within `windowDays` of that day.
 * Demos still inside their window are counted apart (`waiting`), never as "not converted".
 */
export function demoToAdmissionConversion(
  rows: readonly OverviewDemoRow[],
  cohort: KpiWindow,
  windowDays: number,
  asOf: Date,
) {
  const today = istToday(asOf);
  const inCohort = rows.flatMap((r) => {
    const first = firstDemoDay(r.sessions);
    return first && inWindow(first, cohort) ? [{ first, confirmedAt: r.confirmedAt }] : [];
  });
  const settled = inCohort.filter((r) => daysBetween(r.first, today) >= windowDays);
  // Confirmed before the first demo day is not a conversion by this demo.
  const after = (r: (typeof settled)[number]) =>
    r.confirmedAt ? daysBetween(r.first, istToday(r.confirmedAt)) : -1;
  const converted = settled.filter((r) => after(r) >= 0 && after(r) <= windowDays).length;
  const m = meta(
    `Demos whose first demo day is in the window and whose ${windowDays}-day window has ended, that reached "admission confirmed" within ${windowDays} days of the first demo day ÷ those demos.`,
    cohort,
    'percent',
  );
  return {
    converted,
    cohort: settled.length,
    waiting: inCohort.length - settled.length,
    rate: settled.length
      ? metric.ok(pct(converted, settled.length), m)
      : metric.missing(
          inCohort.length
            ? `Every demo in the window is still inside its ${windowDays}-day window.`
            : 'No demo had its first demo day in the window.',
          m,
        ),
  };
}

/** Application statuses that wait for staff or the family (brief §4), in workflow order. */
export const AWAITING_STATUSES = [
  'draft',
  'ready_for_review',
  'form_generated',
  'signatures_confirmed',
] as const satisfies readonly ApplicationStatus[];

/** Applications at each waiting status right now (the list's status filter shows the same rows). */
export function applicationsAwaiting(rows: readonly { status: string }[], asOf: Date) {
  const count = pointCount(asOf, 'As of today');
  return Object.fromEntries(
    AWAITING_STATUSES.map((s) => [
      s,
      count(
        rows.filter((r) => r.status === s).length,
        `Applications at "${APPLICATION_STATUS_LABELS[s]}" right now.`,
      ),
    ]),
  ) as Record<(typeof AWAITING_STATUSES)[number], Metric>;
}

/** Admissions confirmed (final approval) on an IST day in the window, and those rows. */
export function admissionsConfirmed<R extends { approvedAt: Date }>(
  rows: readonly R[],
  window: KpiWindow,
) {
  const inW = rows.filter((r) => inWindow(istToday(r.approvedAt), window));
  return {
    rows: inW,
    metric: metric.ok(
      inW.length,
      meta(
        'Admissions confirmed with the approver’s password re-check in the window (one per admission case). Legacy admissions without an approval record are not counted.',
        window,
        'count',
      ),
    ),
  };
}

/** Overdue onboarding items (isOnboardingOverdue), those rows, and how many admissions have one. */
export function overdueOnboarding<
  R extends { admissionId: string; dueDate: string | null; status: OnboardingStatus },
>(items: readonly R[], asOf: Date) {
  const today = istToday(asOf);
  const overdue = items.filter((i) => isOnboardingOverdue(i, today));
  const m = meta(
    'Onboarding checklist items with a due date before today that are not completed or not applicable.',
    pointInTime(asOf),
    'count',
    'As of today',
  );
  return {
    rows: overdue,
    admissions: new Set(overdue.map((i) => i.admissionId)).size,
    items: items.length
      ? metric.ok(overdue.length, m)
      : metric.missing('No onboarding checklist has been built yet.', m),
  };
}

type CollectedRecord = FeeRecordLike & { paymentDate: string | null };

/**
 * Money recorded as received minus refunds, by payment date (IST) in the window, per charge.
 * Voided and reversed rows never count. null = no fee record at all (unknown, not ₹0).
 */
export function feeCollections(records: readonly CollectedRecord[], window: KpiWindow) {
  if (!records.length) return null;
  const counted = effectiveRecords(records).filter(
    (r) => r.paymentDate && inWindow(r.paymentDate, window),
  );
  const byCategory = Object.fromEntries(
    FEE_CHARGE_CATEGORIES.map((c) => {
      const s = ledgerSums(counted.filter((r) => (r.chargeCategory ?? 'tuition') === c));
      return [c, s.received - s.refund];
    }),
  ) as Record<FeeChargeCategory, number>;
  return { byCategory, netPaise: Object.values(byCategory).reduce((n, v) => n + v, 0) };
}

/** Tuition still owed (and credit held) across active agreements; null = no active agreement. */
export function tuitionOutstanding(
  totals: readonly Pick<PlanTotals, 'outstandingPaise' | 'creditPaise'>[],
) {
  if (!totals.length) return null;
  const sum = (k: 'outstandingPaise' | 'creditPaise') => totals.reduce((n, t) => n + t[k], 0);
  return {
    agreements: totals.length,
    outstandingPaise: sum('outstandingPaise'),
    creditPaise: sum('creditPaise'),
  };
}
