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
  'in_review',
  'cancelled',
  'draft',
  'changes_requested',
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
  'blocked_set',
  'blocked_cleared',
  'checklist_changed',
  'collaborator_added',
  'delivered',
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

/** Statuses task_events may hold: today's plus the retired `blocked` / `on_hold` (history, R4). */
export const TASK_EVENT_STATUSES = [...TASK_STATUSES, 'blocked', 'on_hold'] as const;
export const TASK_BLOCK_KINDS = ['blocked', 'on_hold'] as const;
export type TaskEventStatus = (typeof TASK_EVENT_STATUSES)[number];
export type TaskBlockKind = (typeof TASK_BLOCK_KINDS)[number];

/** R4 labels; `done` reads "Approved" when review was required (`taskStatusLabel`). */
export const TASK_STATUS_LABELS: Record<TaskEventStatus, string> = {
  draft: 'Draft',
  pending: 'Assigned',
  in_progress: 'In progress',
  in_review: 'Submitted',
  changes_requested: 'Changes requested',
  done: 'Done',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
  on_hold: 'On hold',
};
export const taskStatusLabel = (s: TaskEventStatus, reviewRequired = false) =>
  s === 'done' && reviewRequired ? 'Approved' : TASK_STATUS_LABELS[s];

/** Statuses the work is still with the assignee (the only ones that can be overdue, R5). */
export const WORK_STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'changes_requested'];

/** Statuses the database refuses without a reason (staff_tasks_reason_check). */
export const needsReason = (status: TaskStatus) => status === 'cancelled';

export interface TaskState {
  status: TaskStatus;
  progressPercent: number;
  reason: string | null;
}

/**
 * A-TSK-1: apply a change to a task (null = new task). Done ⇒ 100% and no reason. A reason
 * explains the current status: a status change drops it unless a reason is given again, so an
 * older "why" never satisfies a later EOD. Cancelled always needs one (blocked is a flag, R4).
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
    error: missing ? { field: 'reason', message: 'Say why the task is cancelled.' } : null,
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

/**
 * The deadline (R5): the end of its stated IST minute, or of 23:59 IST that day when no time is
 * set — so 10:30 is on time for "due 10:30" and 00:00 the next day is late.
 */
export const deadlineInstant = (dueOn: string, dueTime: string | null) =>
  new Date(+istInstant(dueOn, dueTime?.slice(0, 5) ?? '23:59') + 59_999);

/**
 * A-TSK-2 (R5): still with the assignee (assigned, in progress, changes requested) and past the
 * deadline in force (after it, not at it). Draft, submitted, done and cancelled work is never
 * overdue.
 */
export function isOverdue(t: Pick<EodTask, 'status' | 'dueOn' | 'dueTime'>, now: Date): boolean {
  return WORK_STATUSES.includes(t.status) && now > deadlineInstant(t.dueOn, t.dueTime);
}

export interface DueChange {
  occurredAt: Date;
  data: Record<string, unknown> | null;
}

/**
 * R5: was the first submission on time? Judged against the deadline in force at that moment
 * (the latest `due_changed` before it, else the original). Approval time never enters it.
 * null = not submitted yet.
 */
export function submittedOnTime(
  t: { firstSubmittedAt: Date | null; originalDueOn: string; originalDueTime: string | null },
  changes: readonly DueChange[],
): boolean | null {
  if (!t.firstSubmittedAt) return null;
  const at = t.firstSubmittedAt;
  const last = changes
    .filter((c) => c.occurredAt <= at)
    .sort((a, b) => +a.occurredAt - +b.occurredAt)
    .at(-1)?.data;
  const due = last
    ? deadlineInstant(String(last.toDueOn), (last.toDueTime as string | null) ?? null)
    : deadlineInstant(t.originalDueOn, t.originalDueTime);
  return at <= due;
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

export { buildEodSnapshot, missingReasons, type EodItem, type EodSnapshot } from './eod-day';

const IST = 'Asia/Kolkata';
const clockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: IST,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const dueDayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "4:42 PM" (IST, the brief's wording). */
export const istClock = (at: Date) => clockFmt.format(at).replace(/\s/g, ' '); // ICU may use a narrow space
/** "23 Oct, 4:10 pm" (IST). */
export const istWhen = (at: Date) => `${dayFmt.format(at)}, ${istClock(at)}`;
/** "Fri, 24 Oct, 5:00 pm" or "Fri, 24 Oct (end of day)". */
export function deadlineText(dueOn: string, dueTime: string | null) {
  const day = dueDayFmt.format(new Date(`${dueOn}T00:00:00Z`));
  return dueTime
    ? `${day}, ${istClock(istInstant(dueOn, dueTime.slice(0, 5)))}`
    : `${day} (end of day)`;
}
