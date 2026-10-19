/**
 * Leave rules (OPS-055…OPS-058). Pure.
 *
 * - Parts: single day → start = end part ∈ {full, first_half, second_half};
 *   several days → start ∈ {full, second_half}, end ∈ {full, first_half}.
 * - Working-day counting skips non-working days and holidays; a half part
 *   counts 0.5.
 * - Overlap: with the employee's own pending/approved leave, half-day aware
 *   (first half and second half of the same day do not overlap).
 * - Balances are a ledger; without an allocation the balance is "not
 *   configured" (never 0). Entitlement, accrual, carry-forward and encashment
 *   are open owner decisions and are not enforced.
 */
import type { IsoDate } from '@elevate/shared-types';
import type { DecisionCheck } from './attendance';
import { eachDate, type Issue } from './calendar';

export type LeavePart = 'full' | 'first_half' | 'second_half';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveSpan {
  startDate: string;
  endDate: string;
  startPart: LeavePart;
  endPart: LeavePart;
}

export function validateLeaveSpan(span: LeaveSpan, halfDayAllowed: boolean): Issue[] {
  const issues: Issue[] = [];
  if (span.endDate < span.startDate) {
    issues.push({ path: 'endDate', message: 'End date must be on or after the start date.' });
    return issues;
  }
  const usesHalf = span.startPart !== 'full' || span.endPart !== 'full';
  if (usesHalf && !halfDayAllowed)
    issues.push({ path: 'startPart', message: 'This leave type does not allow half days.' });
  if (span.startDate === span.endDate) {
    if (span.startPart !== span.endPart)
      issues.push({
        path: 'endPart',
        message: 'For a single day, choose one part (full day, first half or second half).',
      });
  } else {
    if (span.startPart === 'first_half')
      issues.push({
        path: 'startPart',
        message: 'Leave over several days can start with a full day or the second half only.',
      });
    if (span.endPart === 'second_half')
      issues.push({
        path: 'endPart',
        message: 'Leave over several days can end with a full day or the first half only.',
      });
  }
  return issues;
}

/** Which halves of `date` a span covers. */
export function halvesOn(span: LeaveSpan, date: string): { am: boolean; pm: boolean } {
  if (date < span.startDate || date > span.endDate) return { am: false, pm: false };
  const part =
    date === span.startDate ? span.startPart : date === span.endDate ? span.endPart : 'full';
  return { am: part !== 'second_half', pm: part !== 'first_half' };
}

export type DayCount = {
  date: IsoDate;
  fraction: number;
  excluded: 'non_working_day' | 'holiday' | null;
  holidayName?: string;
};

/**
 * Working days of a leave span. `isWorkingDay` says whether the employee works
 * that weekday; `holidays` maps a date to its holiday name.
 */
export function countLeaveDays(
  span: LeaveSpan,
  isWorkingDay: (date: IsoDate) => boolean,
  holidays: ReadonlyMap<string, { name: string }>,
): { days: number; perDate: DayCount[] } {
  const perDate = eachDate(span.startDate as IsoDate, span.endDate as IsoDate).map(
    (date): DayCount => {
      const h = holidays.get(date);
      if (h) return { date, fraction: 0, excluded: 'holiday', holidayName: h.name };
      if (!isWorkingDay(date)) return { date, fraction: 0, excluded: 'non_working_day' };
      const { am, pm } = halvesOn(span, date);
      return { date, fraction: (am ? 0.5 : 0) + (pm ? 0.5 : 0), excluded: null };
    },
  );
  return { days: perDate.reduce((s, d) => s + d.fraction, 0), perDate };
}

/** Existing pending/approved requests that overlap `span` (half-day aware). */
export function overlappingLeave<T extends LeaveSpan & { id: string; status: string }>(
  span: LeaveSpan,
  existing: readonly T[],
  ignoreId?: string,
): T[] {
  return existing.filter((e) => {
    if (e.id === ignoreId) return false;
    if (e.status !== 'pending' && e.status !== 'approved') return false;
    if (e.startDate > span.endDate || span.startDate > e.endDate) return false;
    const from = e.startDate > span.startDate ? e.startDate : span.startDate;
    const to = e.endDate < span.endDate ? e.endDate : span.endDate;
    return eachDate(from as IsoDate, to as IsoDate).some((d) => {
      const a = halvesOn(span, d);
      const b = halvesOn(e, d);
      return (a.am && b.am) || (a.pm && b.pm);
    });
  });
}

/**
 * Cancellation: the requester may cancel a pending request, or an approved one
 * that has not started. An approved request that has started (start ≤ today)
 * can only be cancelled by an approver (never the employee themself); a reason
 * is required then.
 */
export function checkLeaveCancel(input: {
  status: LeaveStatus;
  startDate: string;
  today: string;
  actorIsRequesterOrSubject: boolean;
  actorCanApprove: boolean;
  actorIsSubject: boolean;
  reason?: string | null;
}): DecisionCheck {
  if (input.status !== 'pending' && input.status !== 'approved')
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `A ${input.status} request cannot be cancelled.`,
    };
  const started = input.status === 'approved' && input.startDate <= input.today;
  if (!started) {
    if (input.actorIsRequesterOrSubject || input.actorCanApprove) return { ok: true };
    return { ok: false, code: 'NOT_ALLOWED', message: 'Only the requester can cancel this.' };
  }
  if (!input.actorCanApprove || input.actorIsSubject)
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: 'This leave has started; an approver (not the employee) must cancel it.',
    };
  if (!input.reason?.trim())
    return { ok: false, code: 'NOTE_REQUIRED', message: 'Give a reason for cancelling.' };
  return { ok: true };
}

// --- balance ledger --------------------------------------------------------------------------

export type LedgerEntryType = 'allocation' | 'adjustment' | 'usage' | 'reversal';

export type LeaveBalance =
  | { status: 'not_configured'; reason: string }
  | {
      status: 'configured';
      allocated: number;
      adjusted: number;
      used: number;
      reversed: number;
      balance: number;
    };

/** Sum a ledger. No allocation entry → "not configured" (a balance of 0 would be invented). */
export function balanceFromLedger(
  entries: readonly { entryType: LedgerEntryType; days: number | string }[],
): LeaveBalance {
  if (!entries.some((e) => e.entryType === 'allocation'))
    return {
      status: 'not_configured',
      reason: 'No allocation is recorded for this leave type (entitlements are an open decision).',
    };
  const sum = (t: LedgerEntryType) =>
    entries.filter((e) => e.entryType === t).reduce((s, e) => s + Number(e.days), 0);
  const allocated = sum('allocation');
  const adjusted = sum('adjustment');
  const used = -sum('usage');
  const reversed = sum('reversal');
  return {
    status: 'configured',
    allocated,
    adjusted,
    used,
    reversed,
    balance: round1(allocated + adjusted - used + reversed),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- team availability -----------------------------------------------------------------------

export type AvailabilityCell =
  | { state: 'on_leave'; part: LeavePart; code: string; status: 'approved' | 'pending' }
  | { state: 'scheduled' }
  | { state: 'not_scheduled' };

/** One row per employee, one cell per date: leave first, then schedule. */
export function availabilityGrid(
  dates: readonly IsoDate[],
  people: readonly { staffId: string; scheduledDates: ReadonlySet<string> }[],
  leave: readonly (LeaveSpan & { staffId: string; code: string; status: string })[],
): { staffId: string; cells: AvailabilityCell[] }[] {
  return people.map((p) => ({
    staffId: p.staffId,
    cells: dates.map((d): AvailabilityCell => {
      const l = leave.find(
        (x) =>
          x.staffId === p.staffId &&
          (x.status === 'approved' || x.status === 'pending') &&
          x.startDate <= d &&
          x.endDate >= d,
      );
      if (l) {
        const h = halvesOn(l, d);
        const part: LeavePart = h.am && h.pm ? 'full' : h.am ? 'first_half' : 'second_half';
        return {
          state: 'on_leave',
          part,
          code: l.code,
          status: l.status as 'approved' | 'pending',
        };
      }
      return p.scheduledDates.has(d) ? { state: 'scheduled' } : { state: 'not_scheduled' };
    }),
  }));
}
