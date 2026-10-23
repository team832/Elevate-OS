/**
 * A-TSK-8 replay: a task's state as of a moment, rebuilt from its events (never the current
 * status). Pure; used by the period report facts in domain/eod.ts.
 */
import type { TaskEventKind, TaskPriority, TaskStatus } from './staff-tasks';

/** Statuses an event may hold: today's plus the retired blocked / on hold (history, R4). */
export type EventStatus = TaskStatus | 'blocked' | 'on_hold';
const RETIRED: readonly (EventStatus | null)[] = ['blocked', 'on_hold'];

export interface FactTask {
  id: string;
  title: string;
  priority: TaskPriority;
  dueOn: string;
  dueTime: string | null;
  /** Current owner, status and reason (used only where no event says otherwise). */
  staffId: string;
  status: TaskStatus;
  reason: string | null;
  linkedRef: string | null;
  createdAt: Date;
  completedAt: Date | null;
  originalDueOn?: string;
  originalDueTime?: string | null;
  firstSubmittedAt?: Date | null;
  blockedAt?: Date | null;
  blockedReason?: string | null;
}

export interface FactEvent {
  taskId: string;
  kind: TaskEventKind;
  toStatus: EventStatus | null;
  fromStatus: EventStatus | null;
  fromStaffId: string | null;
  toStaffId: string | null;
  occurredAt: Date;
  reason: string | null;
  /** due_changed: { fromDueOn, toDueOn, fromDueTime, toDueTime }. */
  data: Record<string, unknown> | null;
}

export interface FactUpdate {
  id: string;
  taskId: string;
  occurredOn: string;
  recordedAt: Date;
  workPerformed: string;
  result: string | null;
  blocker: string | null;
  nextStep: string | null;
  durationMinutes: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  correctsUpdateId: string | null;
}

export const OWNERSHIP: readonly TaskEventKind[] = [
  'created',
  'assigned',
  'reassigned',
  'imported',
];
/** The task reached its owner: given to them, or a draft published to them (draft → assigned). */
export const isReceipt = (e: FactEvent) =>
  OWNERSHIP.includes(e.kind) || (e.fromStatus === 'draft' && e.toStatus === 'pending');
export const byTime = (a: FactEvent, b: FactEvent) =>
  a.occurredAt.getTime() - b.occurredAt.getTime();

/** Events grouped by task, oldest first (group once, then replay each task cheaply). */
export function eventsByTask(events: readonly FactEvent[]) {
  const out = new Map<string, FactEvent[]>();
  for (const e of [...events].sort(byTime)) out.set(e.taskId, [...(out.get(e.taskId) ?? []), e]);
  return out;
}

/** What an event says about the blocked flag: set (with reason), cleared, or nothing. */
export const blockOf = (e: FactEvent) =>
  e.kind === 'blocked_set' || RETIRED.includes(e.toStatus)
    ? { on: true, reason: e.reason, since: e.occurredAt }
    : e.kind === 'blocked_cleared' || (RETIRED.includes(e.fromStatus) && e.toStatus)
      ? { on: false, reason: null, since: null }
      : null;

/**
 * A task's owner, lifecycle status, blocked flag, reason and deadline at instant `t`, replayed
 * from its own events (oldest first); null when it did not exist yet. Before the first event
 * that sets a value, its `from…` side holds the earlier value; a task without any status event
 * (legacy rows) falls back to its completion time and otherwise its current status. Retired
 * blocked / on-hold statuses count as the blocked flag, never as a status.
 */
export function taskStateAt(task: FactTask, mine: readonly FactEvent[] = [], t: Date) {
  const born = Math.min(task.createdAt.getTime(), ...mine.map((e) => e.occurredAt.getTime()));
  if (born > t.getTime()) return null;
  const before = mine.filter((e) => e.occurredAt <= t);
  const after = mine.filter((e) => e.occurredAt > t);
  const owners = (list: FactEvent[]) =>
    list.filter((e) => OWNERSHIP.includes(e.kind) && e.toStaffId);
  const statuses = (list: FactEvent[]) =>
    list.filter((e) => e.toStatus && !RETIRED.includes(e.toStatus));
  const dues = (list: FactEvent[]) => list.filter((e) => e.kind === 'due_changed' && e.data);
  const blocks = (list: FactEvent[]) => list.map(blockOf).filter((b) => b !== null);
  const lastOwner = owners(before).at(-1);
  const lastStatus = statuses(before).at(-1);
  const lastDue = dues(before).at(-1);
  const nextDue = dues(after)[0]?.data;
  const prior = statuses(after)[0]?.fromStatus;
  const status = (lastStatus?.toStatus ??
    (prior && !RETIRED.includes(prior) ? prior : null) ??
    (task.completedAt && task.completedAt <= t
      ? 'done'
      : task.status === 'done'
        ? 'pending'
        : task.status)) as TaskStatus;
  const nextBlock = blocks(after)[0];
  const block =
    blocks(before).at(-1) ??
    (nextBlock
      ? { on: !nextBlock.on, reason: null, since: null }
      : task.blockedAt && task.blockedAt <= t
        ? { on: true, reason: task.blockedReason ?? null, since: task.blockedAt }
        : null);
  const due = (d: Record<string, unknown> | null | undefined, side: 'to' | 'from') =>
    d && typeof d[`${side}DueOn`] === 'string'
      ? {
          dueOn: d[`${side}DueOn`] as string,
          dueTime: (d[`${side}DueTime`] as string | null) ?? null,
        }
      : null;
  return {
    owner: lastOwner?.toStaffId ?? owners(after)[0]?.fromStaffId ?? task.staffId,
    status,
    reason: lastStatus?.reason ?? (task.status === status ? task.reason : null),
    since: lastStatus?.occurredAt ?? null,
    blocked: block?.on ? { reason: block.reason, since: block.since } : null,
    dueChangeReason: lastDue?.reason ?? null,
    ...(due(lastDue?.data, 'to') ??
      due(nextDue, 'from') ?? { dueOn: task.dueOn, dueTime: task.dueTime }),
  };
}
