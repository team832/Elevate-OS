/**
 * Task status rules, completion rules and flags (OPS-016, BR-OPS-10, BR-OPS-11).
 * Pure. Algorithm documentation: docs/ALGORITHMS.md → A-08.
 */
import { daysBetween, istToday, type IsoDate } from './dates';

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'waiting',
  'at_risk',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting: 'Waiting',
  at_risk: 'At risk',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'not_started',
  'in_progress',
  'waiting',
  'at_risk',
  'blocked',
];

export function isOpenTask(status: TaskStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

export interface TaskTransitionInput {
  from: TaskStatus;
  to: TaskStatus;
  reason?: string | null;
  completionNote?: string | null;
  evidenceLink?: string | null;
  /** Has an owner (responsible) been assigned? BR-OPS-11: completion needs an owner. */
  hasOwner: boolean;
  /** Codes of blocking tasks that are still open. */
  openBlockers: readonly string[];
  /** Reason to complete despite open blockers (audited). */
  blockerOverrideReason?: string | null;
}

export type TaskTransitionCheck =
  | { ok: true; overrideUsed: boolean }
  | {
      ok: false;
      code:
        | 'NO_CHANGE'
        | 'REASON_REQUIRED'
        | 'EVIDENCE_REQUIRED'
        | 'OWNER_REQUIRED'
        | 'BLOCKED_BY_OPEN_TASKS'
        | 'ILLEGAL';
      message: string;
      blockers?: readonly string[];
    };

const blank = (s: string | null | undefined) => !s || !s.trim();

/**
 * Status transition rules:
 * - any open status → any other open status (moving to `blocked` needs a reason);
 * - open → completed: needs an owner, a completion note or evidence link, and no
 *   open blockers unless an override reason is given;
 * - open → cancelled: needs a reason;
 * - completed/cancelled → in_progress (reopen): needs a reason; nothing else.
 */
export function checkTaskTransition(input: TaskTransitionInput): TaskTransitionCheck {
  const { from, to } = input;
  if (from === to)
    return {
      ok: false,
      code: 'NO_CHANGE',
      message: `The task is already ${TASK_STATUS_LABELS[from]}.`,
    };
  if (!isOpenTask(from)) {
    if (to !== 'in_progress')
      return {
        ok: false,
        code: 'ILLEGAL',
        message: 'A closed task can only be reopened (to In progress).',
      };
    if (blank(input.reason))
      return {
        ok: false,
        code: 'REASON_REQUIRED',
        message: 'Give a reason for reopening the task.',
      };
    return { ok: true, overrideUsed: false };
  }
  if (to === 'completed') {
    if (!input.hasOwner)
      return {
        ok: false,
        code: 'OWNER_REQUIRED',
        message: 'Assign an owner before completing the task (BR-OPS-11).',
      };
    if (blank(input.completionNote) && blank(input.evidenceLink))
      return {
        ok: false,
        code: 'EVIDENCE_REQUIRED',
        message:
          'Completion needs a completion note or an evidence link, not just a tick (BR-OPS-11).',
      };
    if (input.openBlockers.length > 0) {
      if (blank(input.blockerOverrideReason))
        return {
          ok: false,
          code: 'BLOCKED_BY_OPEN_TASKS',
          message: `Blocked by open task(s): ${input.openBlockers.join(', ')}. Finish them first or give an override reason.`,
          blockers: input.openBlockers,
        };
      return { ok: true, overrideUsed: true };
    }
    return { ok: true, overrideUsed: false };
  }
  if ((to === 'cancelled' || to === 'blocked') && blank(input.reason))
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message:
        to === 'cancelled' ? 'Give a reason for cancelling.' : 'Say what the task is blocked on.',
    };
  return { ok: true, overrideUsed: false };
}

export type TaskFlag = 'missing_owner' | 'missing_due' | 'overdue' | 'due_today';

export interface TaskLike {
  status: TaskStatus;
  ownerStaffId: string | null;
  dueDate: IsoDate | null;
}

/** Flags for an open task at `now` (Asia/Kolkata dates). Closed tasks have none. */
export function taskFlags(task: TaskLike, now: Date): { flags: TaskFlag[]; daysOverdue: number } {
  if (!isOpenTask(task.status)) return { flags: [], daysOverdue: 0 };
  const flags: TaskFlag[] = [];
  if (!task.ownerStaffId) flags.push('missing_owner');
  let daysOverdue = 0;
  if (!task.dueDate) flags.push('missing_due');
  else {
    const diff = daysBetween(task.dueDate, istToday(now));
    if (diff > 0) {
      flags.push('overdue');
      daysOverdue = diff;
    } else if (diff === 0) flags.push('due_today');
  }
  return { flags, daysOverdue };
}
