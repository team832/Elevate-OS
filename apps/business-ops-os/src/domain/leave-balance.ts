/**
 * Leave balances (F4-12; every rule Proposed, setting "Leave balances"). Per staff member, leave
 * type and leave year: balance = allowance + carried forward + adjustments − approved leave of that
 * type in the year, counted in calendar days (working days only is an owner question), a half day
 * 0.5. No allowance = "No allowance set": nothing is shown or enforced. A type in "Leave types
 * without a balance" (Proposed: Unpaid) never uses one. The whole allowance is there from the first
 * day of the year (Proposed; monthly accrual is not built). Pure.
 */
import { addDays, daysBetween, type IsoDate } from './dates';
import type { LeaveDayPart } from './leave';

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;
export type Month = (typeof MONTHS)[number];
/** Applying for more than the balance: warn (HR decides) or refuse. */
export const OVER_BALANCE_RULES = ['warn', 'refuse'] as const;

export const NO_ALLOWANCE = 'No allowance set';
export const NO_BALANCE_UNPAID = 'Does not use a balance';

export interface LeaveYear {
  start: IsoDate;
  end: IsoDate;
  /** "2026-27", or "2026" for a January year. */
  label: string;
}

/** The leave year holding `day` (an IST date). */
export function leaveYear(day: string, startMonth: Month): LeaveYear {
  const m = MONTHS.indexOf(startMonth) + 1;
  const [y, month] = day.split('-').map(Number) as [number, number];
  const year = month >= m ? y : y - 1;
  const mm = String(m).padStart(2, '0');
  return {
    start: `${year}-${mm}-01` as IsoDate,
    end: addDays(`${year + 1}-${mm}-01` as IsoDate, -1),
    label: m === 1 ? String(year) : `${year}-${String(year + 1).slice(2)}`,
  };
}

type Span = { fromDate: string; toDate: string; dayPart?: LeaveDayPart | null };

/** Days of this leave from `from` to `to`: calendar days, a half day 0.5. */
export function leaveDaysIn(l: Span, from: string, to: string) {
  const a = l.fromDate > from ? l.fromDate : from;
  const b = l.toDate < to ? l.toDate : to;
  if (a > b) return 0;
  return l.dayPart ? 0.5 : daysBetween(a as IsoDate, b as IsoDate) + 1;
}

/** Each leave year a leave touches, with its days in that year. */
export function leaveYearsOf(l: Span, startMonth: Month) {
  const out: (LeaveYear & { days: number })[] = [];
  for (let y = leaveYear(l.fromDate, startMonth); y.start <= l.toDate; ) {
    out.push({ ...y, days: leaveDaysIn(l, y.start, y.end) });
    y = leaveYear(addDays(y.end, 1), startMonth);
  }
  return out;
}

export type LeaveBalance = { taken: number } & (
  | { state: 'unpaid' | 'not_set' }
  | { state: 'set'; allowance: number; carried: number; adjusted: number; balance: number }
);

export function leaveBalance(i: {
  unpaid: boolean;
  allowance: number | null;
  adjustments: readonly { kind: 'carry_forward' | 'adjustment'; days: number }[];
  taken: number;
}): LeaveBalance {
  if (i.unpaid || i.allowance === null)
    return { state: i.unpaid ? 'unpaid' : 'not_set', taken: i.taken };
  const sum = (kind: string) =>
    i.adjustments.filter((a) => a.kind === kind).reduce((s, a) => s + a.days, 0);
  const carried = sum('carry_forward');
  const adjusted = sum('adjustment');
  return {
    state: 'set',
    allowance: i.allowance,
    carried,
    adjusted,
    taken: i.taken,
    balance: i.allowance + carried + adjusted - i.taken,
  };
}

export const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "4 days left of 12", "1 day over the 12 allowed", "No allowance set" or "Does not use a balance". */
export function balanceText(b: LeaveBalance) {
  if (b.state !== 'set') return b.state === 'unpaid' ? NO_BALANCE_UNPAID : NO_ALLOWANCE;
  const total = b.allowance + b.carried + b.adjusted;
  return b.balance < 0
    ? `${daysText(-b.balance)} over the ${total} allowed`
    : `${daysText(b.balance)} left of ${total}`;
}

/** How far `days` more leave goes past the balance; 0 when it fits or nothing is enforced. */
export const overBalanceBy = (b: LeaveBalance | undefined, days: number) =>
  b?.state === 'set' ? Math.max(0, days - Math.max(0, b.balance)) : 0;

export const overBalanceText = (over: number) => `Over the balance by ${daysText(over)}`;

/** Why `days` cannot be carried into a year, or null. `before` = the year before's balance. */
export function carryProblem(days: number, cap: number, before: LeaveBalance | undefined) {
  if (days > cap)
    return cap === 0
      ? 'Carrying leave forward is off: the setting "Leave balances" allows 0 days.'
      : `At most ${daysText(cap)} can be carried forward (setting "Leave balances").`;
  if (before?.state !== 'set')
    return 'No allowance was set for the year before, so there is nothing to carry forward.';
  if (days > before.balance)
    return `The year before has only ${daysText(Math.max(0, before.balance))} left.`;
  return null;
}
