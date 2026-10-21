/**
 * Staff daily tasks and end-of-day reports (owner decision 21 Oct 2026). Pure.
 * Algorithms: A-TSK-1 status rules, A-TSK-2 overdue, A-TSK-3 next occurrence, A-TSK-4 EOD snapshot.
 * Vocabularies mirror packages/database/src/schema/ops-tasks.ts (a unit test keeps them equal).
 */
import { addDays, istToday, type IsoDate } from './dates';

export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'blocked', 'on_hold'] as const;
export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export const TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export const EOD_STATUSES = ['draft', 'submitted'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
  on_hold: 'On hold',
};

export const needsReason = (status: TaskStatus) => status === 'blocked' || status === 'on_hold';

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
    error: missing ? { field: 'reason', message: 'Say why the task is blocked or on hold.' } : null,
  };
}

/** IST instant of a day (and optional `HH:MM[:SS]` time). */
const istInstant = (day: string, time = '00:00') => new Date(`${day}T${time.slice(0, 5)}:00+05:30`);

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

export interface EodItem extends TaskState {
  id: string;
  title: string;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  overdue: boolean;
}

export interface EodSnapshot {
  reportDate: string;
  generatedAt: string;
  /** Completed on the report day. */
  done: EodItem[];
  /** Due on the report day and not done. */
  open: EodItem[];
  /** Due before the report day and still not done. */
  carried: EodItem[];
  counts: { done: number; open: number; carried: number; overdue: number };
}

const RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const byPriority = (a: EodTask, b: EodTask) =>
  RANK[a.priority] - RANK[b.priority] || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99');

/**
 * A-TSK-4: the day's report from the owner's tasks. Overdue is judged at `now`, or at the end
 * of the report day when that day is over. Tasks keep their current status and reason.
 */
export function buildEodSnapshot(tasks: EodTask[], reportDate: string, now: Date): EodSnapshot {
  const endOfDay = new Date(istInstant(addDays(reportDate as IsoDate, 1)).getTime() - 1);
  const asOf = now < endOfDay ? now : endOfDay;
  const item = (t: EodTask): EodItem => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
    progressPercent: t.progressPercent,
    reason: t.reason,
    dueOn: t.dueOn,
    dueTime: t.dueTime,
    overdue: isOverdue(t, asOf),
  });
  const notDone = tasks.filter((t) => t.status !== 'done').sort(byPriority);
  const done = tasks
    .filter((t) => t.completedAt && istToday(t.completedAt) === reportDate)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .map(item);
  const open = notDone.filter((t) => t.dueOn === reportDate).map(item);
  const carried = notDone.filter((t) => t.dueOn < reportDate).map(item);
  return {
    reportDate,
    generatedAt: now.toISOString(),
    done,
    open,
    carried,
    counts: {
      done: done.length,
      open: open.length,
      carried: carried.length,
      overdue: [...open, ...carried].filter((t) => t.overdue).length,
    },
  };
}

/** Tasks the report lists as not done that still have no reason (submit needs one each). */
export const missingReasons = (s: EodSnapshot) =>
  [...s.open, ...s.carried].filter((t) => !t.reason);
