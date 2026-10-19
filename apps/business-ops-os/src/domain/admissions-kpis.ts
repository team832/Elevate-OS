/**
 * Admissions dashboard KPIs (OPS-078) — pure; callers pass plain rows.
 * Definitions: docs/parts/admissions.md → "KPI definitions"; algorithm A-ADM-4.
 * Shared helpers (cohort conversion, windows) stay in ./kpis.ts and are reused.
 *
 * MISSING IS NOT ZERO: a rate with denominator 0 is `missing` with a reason.
 * Counts from Ops' own complete tables are `ok`, and a real 0 shows as 0.
 */
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, istToday, windowLabel, type IsoDate } from './dates';
import type { KpiWindow } from './kpis';
import { ADMISSION_STATUSES, type AdmissionStatus } from './pipeline';
import type { FeeApprovalState } from './admission-readiness';

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
  const counts = new Map<string, number>();
  for (const r of first.values())
    if (inWindow(istToday(r.receivedAt), window))
      counts.set(r.sourceCode, (counts.get(r.sourceCode) ?? 0) + 1);
  return [...counts.entries()]
    .map(([sourceCode, count]) => ({ sourceCode, count }))
    .sort((a, b) => b.count - a.count || a.sourceCode.localeCompare(b.sourceCode));
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
 * K-ADM-06/07: `admission_pending` cases split by the fee-arrangement decision.
 * "Applications awaiting decision" = no approved arrangement yet (none, pending,
 * rejected, withdrawn); "offers awaiting response" = arrangement approved (the
 * offer) but the family has not completed admission yet. No separate offer state exists.
 */
export function pendingDecisions(
  rows: readonly AdmissionKpiRow[],
  asOf: Date,
): { awaitingDecision: Metric; awaitingApproval: Metric; offersAwaitingResponse: Metric } {
  const pending = rows.filter((r) => r.status === 'admission_pending');
  const w = pointInTime(asOf);
  return {
    awaitingDecision: metric.ok(
      pending.filter((r) => r.feeApproval !== 'approved').length,
      meta(
        'Cases at "admission pending" without an approved fee arrangement (application under review).',
        w,
        'count',
        'As of today',
      ),
    ),
    awaitingApproval: metric.ok(
      pending.filter((r) => r.feeApproval === 'pending').length,
      meta(
        'Of those, cases whose fee-arrangement approval request is waiting for an approver.',
        w,
        'count',
        'As of today',
      ),
    ),
    offersAwaitingResponse: metric.ok(
      pending.filter((r) => r.feeApproval === 'approved').length,
      meta(
        'Cases at "admission pending" whose fee arrangement is approved (offer made) but not yet admitted.',
        w,
        'count',
        'As of today',
      ),
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
  const w = pointInTime(asOf);
  return {
    upcoming: metric.ok(
      scheduled.filter((r) => r.scheduledAt >= asOf).length,
      meta('Counselling sessions scheduled from now on.', w, 'count', 'As of now'),
    ),
    pastUnrecorded: metric.ok(
      scheduled.filter((r) => r.scheduledAt < asOf).length,
      meta(
        'Sessions whose time has passed but whose outcome (completed / no-show / cancelled) is not recorded.',
        w,
        'count',
        'As of now',
      ),
    ),
  };
}

export interface DemoKpiRow {
  status: 'scheduled' | 'attended' | 'missed' | 'cancelled' | string;
  dayDates: readonly string[];
}

/** K-ADM-05: scheduled demos with at least one demo day in [today, today + days − 1] (IST). */
export function upcomingDemos(rows: readonly DemoKpiRow[], asOf: Date, days = 7): Metric {
  const today = istToday(asOf);
  const w: KpiWindow = { from: today, to: addDays(today, days - 1) as IsoDate };
  const n = rows.filter(
    (r) => r.status === 'scheduled' && r.dayDates.some((d) => inWindow(d, w)),
  ).length;
  return metric.ok(
    n,
    meta(`Scheduled demos with a demo day in the next ${days} days (including today).`, w, 'count'),
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
  return metric.ok(
    rows.filter((r) => r.status === 'open' && r.dueDate < today).length,
    meta(
      'Open follow-ups with a due date before today (Asia/Kolkata).',
      pointInTime(asOf),
      'count',
      'As of today',
    ),
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
  const counts = new Map<string, number>();
  for (const r of rows)
    if (inWindow(istToday(r.at), window)) {
      const k = r.reasonCode ?? 'not_coded';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  return [...counts.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode));
}
