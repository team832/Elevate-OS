/**
 * Admissions dashboard KPIs (OPS-078) — pure; callers pass plain rows.
 * Definitions: docs/KPI_DEFINITIONS.md; algorithm A-ADM-4.
 * Shared helpers (cohort conversion, windows) stay in ./kpis.ts and are reused.
 *
 * MISSING IS NOT ZERO: a rate with denominator 0 is `missing` with a reason.
 * Counts from Ops' own complete tables are `ok`, and a real 0 shows as 0.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, daysBetween, istToday, windowLabel, type IsoDate } from './dates';
import type { KpiWindow } from './kpis';
import { ADMISSION_STATUSES, type AdmissionStatus } from './pipeline';
import type { FeeApprovalState } from './admission-readiness';
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

const inWindow = (d: string, w: KpiWindow) => d >= w.from && d <= w.to;
const pct = (num: number, den: number) => Math.round((num / den) * 1000) / 10;
const meta = (definition: string, w: KpiWindow, unit: Metric['unit'], label?: string) => ({
  definition,
  window: { from: w.from, to: w.to, label: label ?? windowLabel(w.from, w.to) },
  unit,
});
const pointInTime = (asOf: Date): KpiWindow => {
  const d = istToday(asOf);
  return { from: d, to: d };
};
/** A point-in-time count ("As of today" / "As of now"). */
const pointCount = (asOf: Date, label: string) => (n: number, definition: string) =>
  metric.ok(n, meta(definition, pointInTime(asOf), 'count', label));
/** [key, count] pairs, most frequent first, then by key. */
const ranked = (keys: Iterable<string>) => {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

// --- enquiries and sources ---------------------------------------------------------------------

export interface EnquiryKpiRow {
  leadId: string;
  receivedAt: Date;
  sourceCode: string;
}

/** K-ADM-01: enquiries (every enquiry, not only first ones) received in the window (IST dates). */
export function newEnquiries(rows: readonly EnquiryKpiRow[], window: KpiWindow): Metric {
  const n = rows.filter((r) => inWindow(istToday(r.receivedAt), window)).length;
  return metric.ok(
    n,
    meta(
      'Enquiries received in the window (Asia/Kolkata dates); a returning person counts once per enquiry.',
      window,
      'count',
    ),
  );
}

/**
 * K-ADM-02: new leads by FIRST source — for each lead whose earliest enquiry
 * falls in the window, the source of that earliest enquiry. Sorted by count
 * (desc), then source code. Unknown stays UNKNOWN (BR-OPS-5).
 */
export function leadsBySource(
  rows: readonly EnquiryKpiRow[],
  window: KpiWindow,
): { sourceCode: string; count: number }[] {
  const first = new Map<string, EnquiryKpiRow>();
  for (const r of rows) {
    const prev = first.get(r.leadId);
    if (!prev || r.receivedAt < prev.receivedAt) first.set(r.leadId, r);
  }
  return ranked(
    [...first.values()]
      .filter((r) => inWindow(istToday(r.receivedAt), window))
      .map((r) => r.sourceCode),
  ).map(([sourceCode, count]) => ({ sourceCode, count }));
}

// --- pipeline snapshot ---------------------------------------------------------------------------

export interface AdmissionKpiRow {
  status: AdmissionStatus;
  feeApproval: FeeApprovalState;
}

/** K-ADM-03: admission cases by current status (point in time; merged duplicates excluded by the caller). */
export function admissionsByStatus(
  rows: readonly AdmissionKpiRow[],
): Record<AdmissionStatus, number> {
  const out = Object.fromEntries(ADMISSION_STATUSES.map((s) => [s, 0])) as Record<
    AdmissionStatus,
    number
  >;
  for (const r of rows) out[r.status] += 1;
  return out;
}

/**
 * K-ADM-06/07: `admission_pending` cases split by their fee agreement's approval.
 * "Applications awaiting decision" = no active approved agreement yet (none, pending,
 * rejected, withdrawn); "offers awaiting response" = agreement approved and active (the
 * offer) but the admission is not confirmed yet. No separate offer state exists.
 */
export function pendingDecisions(
  rows: readonly AdmissionKpiRow[],
  asOf: Date,
): { awaitingDecision: Metric; awaitingApproval: Metric; offersAwaitingResponse: Metric } {
  const pending = rows.filter((r) => r.status === 'admission_pending');
  const count = pointCount(asOf, 'As of today');
  return {
    awaitingDecision: count(
      pending.filter((r) => r.feeApproval !== 'approved').length,
      'Cases at "admission pending" without an active approved fee agreement (application under review).',
    ),
    awaitingApproval: count(
      pending.filter((r) => r.feeApproval === 'pending').length,
      'Of those, cases whose fee agreement approval request is waiting for an approver.',
    ),
    offersAwaitingResponse: count(
      pending.filter((r) => r.feeApproval === 'approved').length,
      'Cases at "admission pending" whose fee agreement is approved and active (offer made) but not yet confirmed.',
    ),
  };
}

// --- schedule ------------------------------------------------------------------------------------

export interface SessionKpiRow {
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled' | string;
  scheduledAt: Date;
}

/** K-ADM-04: counselling sessions still `scheduled` — upcoming, and past but not recorded. */
export function pendingCounselling(
  rows: readonly SessionKpiRow[],
  asOf: Date,
): { upcoming: Metric; pastUnrecorded: Metric } {
  const scheduled = rows.filter((r) => r.status === 'scheduled');
  const count = pointCount(asOf, 'As of now');
  return {
    upcoming: count(
      scheduled.filter((r) => r.scheduledAt >= asOf).length,
      'Counselling sessions scheduled from now on.',
    ),
    pastUnrecorded: count(
      scheduled.filter((r) => r.scheduledAt < asOf).length,
      'Sessions whose time has passed but whose outcome (completed / no-show / cancelled) is not recorded.',
    ),
  };
}

/** One demo session: its demo, the demo outcome, the session attendance and start. */
export interface DemoKpiRow {
  demoId: string;
  outcome: string;
  attendance: string;
  startsAt: Date;
}

/** K-ADM-05: open demos with a still-scheduled class in [today, today + days − 1] (IST). */
export function upcomingDemos(rows: readonly DemoKpiRow[], asOf: Date, days = 7): Metric {
  const today = istToday(asOf);
  const w: KpiWindow = { from: today, to: addDays(today, days - 1) as IsoDate };
  const n = new Set(
    rows
      .filter(
        (r) =>
          r.outcome === 'open' && r.attendance === 'scheduled' && inWindow(istToday(r.startsAt), w),
      )
      .map((r) => r.demoId),
  ).size;
  return metric.ok(
    n,
    meta(`Open demos with a class in the next ${days} days (including today).`, w, 'count'),
  );
}

// --- enrolment handoff ---------------------------------------------------------------------------

export interface HandoffKpiRow {
  /** When the request event was published (one row per attempt). */
  occurredAt: Date;
  /** Reply Academic published for this request, if any. */
  reply: 'confirmed' | 'rejected' | null;
  /** Academic's delivery state of the request (null = not picked up). */
  academicDelivery: 'processed' | 'failed' | 'dead' | string | null;
}

/**
 * K-ADM-09: handoff attempts requested in the window and their outcome.
 * failed = Academic delivery `dead` without a reply (needs a person);
 * awaiting = neither replied nor dead. Success rate = confirmed ÷ (confirmed +
 * rejected + failed); missing when no attempt has a final outcome.
 */
export function handoffOutcomes(rows: readonly HandoffKpiRow[], window: KpiWindow) {
  const inW = rows.filter((r) => inWindow(istToday(r.occurredAt), window));
  const confirmed = inW.filter((r) => r.reply === 'confirmed').length;
  const rejected = inW.filter((r) => r.reply === 'rejected').length;
  const failed = inW.filter((r) => !r.reply && r.academicDelivery === 'dead').length;
  const awaiting = inW.length - confirmed - rejected - failed;
  const final = confirmed + rejected + failed;
  const m = meta(
    'Handoff attempts requested in the window that Academic OS confirmed ÷ attempts with a final outcome (confirmed, rejected, or failed after all retries).',
    window,
    'percent',
  );
  const count = (n: number, what: string) => metric.ok(n, meta(what, window, 'count'));
  return {
    requested: count(inW.length, 'Enrolment requests (attempts) published in the window.'),
    confirmed: count(confirmed, 'Of those, confirmed by Academic OS.'),
    rejected: count(rejected, 'Of those, rejected by Academic OS (reason shown on the case).'),
    failed: count(failed, 'Of those, failed after all automatic retries (needs a person).'),
    awaiting: count(awaiting, 'Of those, still without a final outcome.'),
    successRate:
      final === 0
        ? metric.missing('No enrolment request in the window has a final outcome yet.', m)
        : metric.ok(pct(confirmed, final), m),
  };
}

// --- follow-ups and closures ---------------------------------------------------------------------

export interface FollowUpKpiLite {
  status: 'open' | 'done' | 'cancelled' | string;
  dueDate: string;
}

/** K-ADM-10: open lead follow-ups whose due date (IST) is before today. */
export function overdueFollowUps(rows: readonly FollowUpKpiLite[], asOf: Date): Metric {
  const today = istToday(asOf);
  return pointCount(asOf, 'As of today')(
    rows.filter((r) => r.status === 'open' && r.dueDate < today).length,
    'Open follow-ups with a due date before today (Asia/Kolkata).',
  );
}

export interface ClosureKpiRow {
  at: Date;
  reasonCode: string | null;
}

/** K-ADM-11: cases closed (→ lost) in the window by reason code; uncoded closures are `not_coded`. */
export function closuresByReason(
  rows: readonly ClosureKpiRow[],
  window: KpiWindow,
): { reasonCode: string; count: number }[] {
  return ranked(
    rows.filter((r) => inWindow(istToday(r.at), window)).map((r) => r.reasonCode ?? 'not_coded'),
  ).map(([reasonCode, count]) => ({ reasonCode, count }));
}

// --- admissions overview (owner brief 21 Oct 2026 §4) --------------------------------------------

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
