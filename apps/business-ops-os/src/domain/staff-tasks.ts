/**
 * Staff daily tasks and end-of-day reports (owner decision 21 Oct 2026). Pure.
 * Algorithms: A-TSK-1 status rules, A-TSK-2 overdue, A-TSK-3 next occurrence, A-TSK-4 EOD snapshot.
 * Vocabularies mirror packages/database/src/schema/ops-tasks.ts and ops-eod.ts (a unit test keeps
 * them equal).
 */
import { addDays, istInstant, type IsoDate } from './dates';

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'blocked',
  'on_hold',
  'in_review',
  'cancelled',
] as const;
export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export const TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export const TASK_SOURCES = [
  'manager',
  'self',
  'verbal',
  'academic',
  'import',
  'recurring',
] as const;
export const TASK_EVENT_KINDS = [
  'created',
  'assigned',
  'reassigned',
  'acknowledged',
  'clarification_requested',
  'status_changed',
  'submitted_for_review',
  'review_approved',
  'changes_requested',
  'reopened',
  'cancelled',
  'due_changed',
  'priority_changed',
  'comment',
  'imported',
  'dependency_added',
  'edited',
] as const;
export const EOD_STATUSES = ['draft', 'submitted', 'revision_requested', 'acknowledged'] as const;
export const EOD_REVIEW_EVENT_KINDS = [
  'viewed',
  'comment',
  'clarification_requested',
  'revision_requested',
  'acknowledged',
  'follow_up_task_created',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];
export type EodStatus = (typeof EOD_STATUSES)[number];
export type EodReviewEventKind = (typeof EOD_REVIEW_EVENT_KINDS)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
  on_hold: 'On hold',
  in_review: 'In review',
  cancelled: 'Cancelled',
};

/** Statuses the database refuses without a reason (staff_tasks_reason_check). */
export const needsReason = (status: TaskStatus) =>
  status === 'blocked' || status === 'on_hold' || status === 'cancelled';

export interface TaskState {
  status: TaskStatus;
  progressPercent: number;
  reason: string | null;
}

/**
 * A-TSK-1: apply a change to a task (null = new task). Done ⇒ 100% and no reason. A reason
 * explains the current status: a status change drops it unless a reason is given again, so an
 * older "why" never satisfies a later EOD. Blocked and on hold always need one.
 */
export function resolveTaskState(
  cur: TaskState | null,
  patch: Partial<TaskState>,
): { state: TaskState; error: { field: 'reason'; message: string } | null } {
  const from = cur ?? { status: 'pending', progressPercent: 0, reason: null };
  const status = patch.status ?? from.status;
  const given = patch.reason === undefined ? undefined : patch.reason?.trim() || null;
  const kept = status === from.status ? from.reason : null;
  const reason = status === 'done' ? null : given === undefined ? kept : given;
  const state = {
    status,
    progressPercent: status === 'done' ? 100 : (patch.progressPercent ?? from.progressPercent),
    reason,
  };
  const missing = needsReason(status) && !reason;
  return {
    state,
    error: missing
      ? { field: 'reason', message: 'Say why the task is blocked, on hold or cancelled.' }
      : null,
  };
}

export interface EodTask extends TaskState {
  id: string;
  title: string;
  details: string | null;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  completedAt: Date | null;
}

/** A-TSK-2: not done and past its due time (or past its due day when no time is set), in IST. */
export function isOverdue(t: Pick<EodTask, 'status' | 'dueOn' | 'dueTime'>, now: Date): boolean {
  if (t.status === 'done') return false;
  const deadline = t.dueTime
    ? istInstant(t.dueOn, t.dueTime)
    : istInstant(addDays(t.dueOn as IsoDate, 1));
  return now >= deadline;
}

/**
 * A-TSK-3: the due day of the next occurrence. Monthly keeps the series' day of the month and
 * clamps it to the month's end (31 Jan → 28 Feb → 31 Mar). A clamped day is always the last day
 * of its month and its previous occurrence (`prevDueOn`) still holds the anchor day.
 */
export function nextOccurrence(
  dueOn: string,
  recurrence: TaskRecurrence,
  prevDueOn?: string | null,
): string | null {
  if (recurrence === 'none') return null;
  if (recurrence !== 'monthly') return addDays(dueOn as IsoDate, recurrence === 'daily' ? 1 : 7);
  const [y, m, d] = dueOn.split('-').map(Number) as [number, number, number];
  const lastOf = (month: number) => new Date(Date.UTC(y, month, 0)).getUTCDate();
  const anchor = prevDueOn && d === lastOf(m) ? Math.max(d, Number(prevDueOn.slice(8))) : d;
  return new Date(Date.UTC(y, m, Math.min(anchor, lastOf(m + 1)))).toISOString().slice(0, 10);
}

export { buildEodSnapshot, missingReasons, type EodItem, type EodSnapshot } from './eod';
