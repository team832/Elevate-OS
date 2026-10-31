/**
 * Leave applications (owner decision 31 Oct 2026; rows in server/leave-applications.ts). Pure rules:
 * dates, who may approve, who may cancel what. Past-dated leave is allowed: sick leave is often
 * applied for afterwards. No balances, entitlements or accrual: those rules are the owner's.
 */
import { fmtDay } from '@elevate/shared-types';
import { addDays, type IsoDate } from './dates';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
/** An application in one of these holds its dates: another may not overlap them. */
export const LEAVE_HOLDS_DATES = ['pending', 'approved'] as const;
/** Setting hr.leave_approver names roles from this list. */
export const LEAVE_APPROVERS = ['hr_manager', 'operations_manager'] as const;

export const LEAVE_NOT_APPROVER =
  'Under the HR setting "Who approves leave", your role does not decide leave.';

/**
 * Why someone is on leave can be medical. Proposed (an owner question): only that person and holders
 * of ops:attendance:manage read these words; directors and auditors see the type, dates and status.
 */
const WHY = ['reason', 'decisionNote', 'cancelReason'] as const;
type Why = (typeof WHY)[number];
export const LEAVE_WHY_HIDDEN = 'Seen by HR only';

const withoutWhy = <T extends object>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !(WHY as readonly string[]).includes(k))) as Omit<T, Why>;

/** Rows as this reader may have them: a hidden field is absent, not empty. */
export const leaveRowsFor = <T extends { staffId: string }>(
  rows: readonly T[],
  manages: boolean,
  ownStaffId: string | null,
) =>
  rows.map((r) => (manages || r.staffId === ownStaffId ? r : withoutWhy(r))) as (Omit<T, Why> &
    Partial<Pick<T, Why & keyof T>>)[];

/** What the audit trail keeps of a leave row: ids, dates, type and status, never the words. */
export const leaveAudit = ({ before, after }: { before?: object | null; after?: object | null }) => ({
  before: before ? withoutWhy(before) : before,
  after: after ? withoutWhy(after) : after,
});

/** Catches a mistyped year, nothing more; not a leave policy. No setting exists for it. */
const YEAR_DAYS = 365;

export function leaveDatesProblem(from: string, to: string, today: string) {
  const reach = (day: string, n: number) => addDays(day as IsoDate, n);
  if (from < reach(today, -YEAR_DAYS))
    return { path: 'fromDate', message: 'The first day is over a year ago. Check the year.' };
  if (to > reach(today, YEAR_DAYS))
    return { path: 'toDate', message: 'The last day is over a year away. Check the year.' };
  if (to > reach(from, YEAR_DAYS))
    return { path: 'toDate', message: 'One application can cover a year at most. Check the dates.' };
  return null;
}

export const mayApproveLeave = (roles: readonly string[], who: readonly string[]) =>
  roles.some((r) => who.includes(r));

const closed = (word: string) => ({
  forbidden: false,
  message: `This application was ${word}, so there is nothing to cancel.`,
});

/**
 * Why this person cannot cancel this application, or null when they can. The applicant cancels
 * while it waits. Cancelling approved leave is HR's, with a reason (Proposed: an owner question),
 * so nobody undoes their own approved leave alone, HR included.
 */
export function cancelRefusal(status: LeaveStatus, mine: boolean) {
  if (status === 'rejected') return closed('rejected');
  if (status === 'cancelled') return closed('cancelled');
  if (status === 'pending')
    return mine
      ? null
      : {
          forbidden: false,
          message: 'Only the person who applied can cancel this. To say no, reject it with a reason.',
        };
  return mine
    ? {
        forbidden: true,
        message:
          'Approved leave is cancelled by HR. Ask HR to cancel it; if you are in HR, ask another HR person.',
      }
    : null;
}

/** "2 Nov 2026 to 4 Nov 2026", or the one day. */
export const leaveRange = (from: string, to: string) =>
  from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`;
