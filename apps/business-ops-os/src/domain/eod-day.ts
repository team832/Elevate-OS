/** A-TSK-4 "My day": the owner's tasks grouped from current task state (the day view). Pure. */
import { addDays, istInstant, istToday, type IsoDate } from './dates';
import { isOverdue, type EodTask, type TaskPriority, type TaskState } from './staff-tasks';

export interface EodItem extends TaskState {
  id: string;
  title: string;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  overdue: boolean;
}

/** "My day" view of the owner's tasks (current state). */
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
export const byPriority = (
  a: { priority: TaskPriority; dueTime: string | null },
  b: { priority: TaskPriority; dueTime: string | null },
) => RANK[a.priority] - RANK[b.priority] || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99');

/**
 * A-TSK-4: the day's tasks from the owner's current task state (the "My day" view). Overdue is
 * judged at `now`, or at the end of the day when that day is over.
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

/** Tasks the day view lists as not done that still have no reason. */
export const missingReasons = (s: EodSnapshot) =>
  [...s.open, ...s.carried].filter((t) => !t.reason);
