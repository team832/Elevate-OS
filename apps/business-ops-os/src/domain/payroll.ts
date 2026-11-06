/**
 * Payroll and payslips (F4-14, Proposed). Pure rules for a monthly run: loss-of-pay days from
 * unpaid leave, the loss-of-pay amount, advance recovery, payslip totals, run states and who may
 * approve. Money is integer paise. Elevate OS computes no statutory
 * PF, ESI or TDS: those are earnings or deductions the owner defines, with the amounts HR sets.
 */
import { datesBetween, monthRange } from './attendance';
import type { IsoDate } from './dates';

export const PAYROLL_RUN_LABELS = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
} as const;
export type PayrollRunStatus = keyof typeof PAYROLL_RUN_LABELS;

export const PAY_MODE_LABELS = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
} as const;

export const LINE_SOURCE_LABELS = {
  structure: 'Salary',
  loss_of_pay: 'Loss of pay',
  advance_recovery: 'Advance recovery',
  one_off: 'One-off',
  adjustment: 'Correction of an earlier month',
} as const;
/** Lines a person adds by hand; the rest come from salaries, leave and advances on every rebuild. */
export const MANUAL_SOURCES = ['one_off', 'adjustment'] as const;

/** The rules as staff read them on the payroll page (one text, so the page and the code agree). */
export const PAYROLL_RULES = [
  'Loss of pay (Proposed): approved leave of the types in the HR setting "Leave types without a balance" only, each calendar day of the month once, a half day as 0.5.',
  'Loss-of-pay amount = monthly gross earnings × loss-of-pay days ÷ days in the month, worked out on whole paise and rounded down once; the part of a paisa left over stays with the staff member, and a whole month of loss of pay equals the gross exactly.',
  'Salary = the salary structure in force on the 1st of the month. Nobody is paid part of a month for joining or leaving in it: add a one-off line.',
  'Advance recovery = the monthly instalment, or what is left of the advance if less, from its first month of recovery; it stops at zero.',
  'Approval: someone holding payroll approval who did not start or submit the run, add a line to it or set a salary it uses. Approved runs cannot change; correct a mistake with a line in the next month.',
  'No PF, ESI or TDS is worked out. Add them as deductions with the amounts you set.',
] as const;

export const daysInMonth = (month: string) => Number(monthRange(month.slice(0, 7)).to.slice(8));

export interface LeaveDay {
  fromDate: string;
  toDate: string;
  kind: string;
  dayPart: string | null;
}

const typeKey = (kind: string) => kind.trim().toLowerCase();

/**
 * Loss-of-pay days in a month from approved leave of the `unpaidTypes` (setting
 * hr.leave_unpaid_types, matched without case or spaces): each date once (whole beats halves).
 */
export function lossOfPayDays(
  month: string,
  leave: readonly LeaveDay[],
  unpaidTypes: readonly string[],
): number {
  const { from, to } = monthRange(month.slice(0, 7));
  const unpaid = new Set(unpaidTypes.map(typeKey));
  const parts = new Map<string, Set<string>>();
  for (const l of leave) {
    if (!unpaid.has(typeKey(l.kind))) continue;
    const start = (l.fromDate > from ? l.fromDate : from) as IsoDate;
    const end = (l.toDate < to ? l.toDate : to) as IsoDate;
    for (const d of datesBetween(start, end))
      parts.set(d, (parts.get(d) ?? new Set()).add(l.dayPart ?? 'whole'));
  }
  return [...parts.values()].reduce((t, p) => t + (p.has('whole') ? 1 : p.size / 2), 0);
}

/** gross × days ÷ days in month on whole paise, rounded down once (days in half steps). */
export function lossOfPayPaise(grossPaise: number, lopDays: number, monthDays: number): number {
  const top = grossPaise * Math.round(lopDays * 2);
  const bottom = 2 * monthDays;
  return (top - (top % bottom)) / bottom;
}

/** This month's recovery of an advance: the instalment, or what is left if less; never below zero. */
export const recoveryPaise = (
  a: { amountPaise: number; monthlyInstalmentPaise: number },
  recoveredPaise: number,
) => Math.max(0, Math.min(a.monthlyInstalmentPaise, a.amountPaise - recoveredPaise));

export function payslipTotals(lines: readonly { kind: string; amountPaise: number }[]) {
  const sum = (kind: string) =>
    lines.filter((l) => l.kind === kind).reduce((t, l) => t + l.amountPaise, 0);
  const earningsPaise = sum('earning');
  const deductionsPaise = sum('deduction');
  return { earningsPaise, deductionsPaise, netPaise: earningsPaise - deductionsPaise };
}

/** Run actions: the state each starts from and leads to, and the audit verb. */
export const RUN_ACTIONS = {
  rebuild: { from: 'draft', to: 'draft', done: 'rebuilt' },
  submit: { from: 'draft', to: 'submitted', done: 'submitted' },
  return: { from: 'submitted', to: 'draft', done: 'returned' },
  approve: { from: 'submitted', to: 'approved', done: 'approved' },
} as const satisfies Record<string, { from: PayrollRunStatus; to: PayrollRunStatus; done: string }>;
export type RunAction = keyof typeof RUN_ACTIONS;

export const LOCKED =
  'This payroll is approved and locked. Correct it with a line in next month’s payroll.';
export const NOT_DRAFT =
  'This payroll was submitted, so its lines are fixed. Send it back to draft to change them.';
export const OWN_RUN = 'You started or submitted this payroll, so someone else approves it.';
export const RUN_AUTHOR =
  'You wrote a line in this payroll or set a salary it uses, so someone else approves it.';
export const NO_APPROVER =
  'Nobody else can approve this payroll: everyone who may approve wrote part of it. Ask the owner to name another approver.';

/**
 * Why `actorId` may not take `action` on the run now, or null. `authors` = who wrote a line in
 * the run or a salary structure it uses (they never approve it).
 */
export function runActionRefusal(
  run: { status: PayrollRunStatus; createdBy: string; submittedBy: string | null },
  action: RunAction,
  actorId: string,
  authors: readonly string[] = [],
): string | null {
  if (run.status === 'approved') return LOCKED;
  if (run.status !== RUN_ACTIONS[action].from)
    return run.status === 'draft'
      ? 'This payroll is still a draft. Submit it for approval first.'
      : NOT_DRAFT;
  if (action !== 'approve') return null;
  if (actorId === run.createdBy || actorId === run.submittedBy) return OWN_RUN;
  if (authors.includes(actorId)) return RUN_AUTHOR;
  return null;
}
