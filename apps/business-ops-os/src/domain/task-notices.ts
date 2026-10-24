/**
 * Task reminders and notification states (owner brief 23 Oct 2026 §8). Pure rules; the job is
 * server/task-reminders.ts.
 *
 * Reminder windows (setting tasks.reminders). A reminder is sent once per window key; the
 * key is stored in ops.task_reminders (unique), so a second run in the same window sends nothing.
 * - due_soon: once per deadline in force, when it is at most `dueSoonHours` away.
 * - overdue: after the deadline, once every `overdueRepeatHours` (window = hours late ÷ interval).
 *   Personal preferences never change this: overdue reminders follow HR's schedule only.
 * - unacknowledged: delivered, not acknowledged, `unacknowledgedHours` after delivery, repeated
 *   every max(`unacknowledgedHours`, personal `reminderIntervalHours`) — a personal choice can
 *   only space these out, never bring them closer together.
 */
import { deadlineInstant } from './staff-tasks';

export interface ReminderSettings {
  dueSoonHours: number;
  overdueRepeatHours: number;
  unacknowledgedHours: number;
}
export interface ReminderTask {
  dueOn: string;
  dueTime: string | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
}
export type ReminderKind = 'due_soon' | 'overdue' | 'unacknowledged';
export interface Reminder {
  kind: ReminderKind;
  windowKey: string;
}

const HOUR = 3_600_000;

/** Open work that is overdue, due within `dueSoonHours`, or neither (null). */
export function dueState(
  t: Pick<ReminderTask, 'dueOn' | 'dueTime'>,
  now: Date,
  dueSoonHours: number,
): 'overdue' | 'due_soon' | null {
  const left = +deadlineInstant(t.dueOn, t.dueTime) - +now;
  return left < 0 ? 'overdue' : left <= dueSoonHours * HOUR ? 'due_soon' : null;
}

/** Reminders an open task calls for at `now`; the caller sends each window key at most once. */
export function remindersDue(
  t: ReminderTask,
  now: Date,
  s: ReminderSettings,
  personalIntervalHours: number | null,
): Reminder[] {
  const due = `${t.dueOn}T${t.dueTime?.slice(0, 5) ?? 'end'}`;
  const state = dueState(t, now, s.dueSoonHours);
  const out: Reminder[] = [];
  if (state === 'overdue') {
    const late = +now - +deadlineInstant(t.dueOn, t.dueTime);
    out.push({
      kind: 'overdue',
      windowKey: `${due}#${Math.floor(late / (s.overdueRepeatHours * HOUR))}`,
    });
  }
  if (state === 'due_soon') out.push({ kind: 'due_soon', windowKey: due });
  if (t.deliveredAt && !t.acknowledgedAt) {
    const waited = +now - +t.deliveredAt - s.unacknowledgedHours * HOUR;
    const every = Math.max(s.unacknowledgedHours, personalIntervalHours ?? 0) * HOUR;
    if (waited >= 0)
      out.push({
        kind: 'unacknowledged',
        windowKey: `${t.deliveredAt.toISOString()}#${Math.floor(waited / every)}`,
      });
  }
  return out;
}

/** The five states of an assignment notification, in order; `at` null = not yet. */
export const NOTICE_STATES = [
  ['delivered', 'Delivered', 'deliveredAt'],
  ['read', 'Read', 'readAt'],
  ['acknowledged', 'Acknowledged', 'acknowledgedAt'],
  ['submitted', 'Work submitted', 'lastSubmittedAt'],
  ['approved', 'Work approved', 'approvedAt'],
] as const;
export type NoticeFacts = Record<(typeof NOTICE_STATES)[number][2], Date | string | null>;

const toDate = (v: Date | string | null) => (v ? new Date(v) : null);

/**
 * Submitted = the latest submission, counted only when it came after this owner's delivery: a
 * reassigned task is delivered again, so an earlier owner's submission is not theirs.
 */
export const noticeStates = (f: NoticeFacts) =>
  NOTICE_STATES.map(([key, label, field]) => {
    const at = toDate(f[field]);
    const delivered = toDate(f.deliveredAt);
    const earlier = key === 'submitted' && at && delivered && at < delivered;
    return { key, label, at: earlier ? null : at };
  });
