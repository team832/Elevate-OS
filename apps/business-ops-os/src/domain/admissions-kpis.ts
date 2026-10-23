/**
 * Admissions dashboard KPIs (OPS-078) — pure; callers pass plain rows.
 * Definitions: docs/KPI_DEFINITIONS.md; algorithm A-ADM-4.
 * Shared helpers (cohort conversion, windows) stay in ./kpis.ts and are reused.
 *
 * MISSING IS NOT ZERO: a rate with denominator 0 is `missing` with a reason.
 * Counts from Ops' own complete tables are `ok`, and a real 0 shows as 0.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, istToday, type IsoDate } from './dates';
import type { KpiWindow } from './kpis';
import { ADMISSION_STATUSES, type AdmissionStatus } from './pipeline';
import type { FeeApprovalState } from './admission-readiness';
import { inWindow, meta, pct, pointCount } from './admissions-kpis-overview';

export {
  admissionsConfirmed,
  applicationsAwaiting,
  AWAITING_STATUSES,
  demoDayProgress,
  demoToAdmissionConversion,
  feeCollections,
  overdueOnboarding,
  tuitionOutstanding,
  type OverviewDemoRow,
} from './admissions-kpis-overview';

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
