/**
 * Task lifecycle, dependencies and work time (owner brief 2 §5, §6, §12; rulings R1, R3). Pure.
 * Algorithms: A-TSK-5 actions and transitions, A-TSK-6 dependency cycles, A-TSK-7 work entries
 * and time. Acknowledgement is separate from status (R1) and never moves work to done.
 */
import { istToday } from './dates';
import type { TaskEventKind, TaskStatus } from './staff-tasks';

export const TASK_ACTIONS = [
  'acknowledge',
  'clarify',
  'start',
  'block',
  'hold',
  'resume',
  'submit',
  'approve',
  'request_changes',
  'complete',
  'cancel',
  'reopen',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * owner = accountable staff; manager = up the owner's manager chain; admin = all-scope write;
 * creator = the user who logged the task (R18: the gate and cancel of assigned work are theirs).
 */
export type TaskRole = 'owner' | 'manager' | 'admin' | 'reviewer' | 'creator';

export interface LifecycleTask {
  status: TaskStatus;
  reviewRequired: boolean;
  acknowledged: boolean;
  /** Logged by its owner for themselves (R18, fixed at creation): the owner may cancel it. */
  selfLogged: boolean;
}
export interface ActionContext {
  roles: readonly TaskRole[];
  /** Setting tasks.completion_without_reviewer (proposed). */
  closedBy: 'owner' | 'manager';
}

const NOT_CLOSED = ['pending', 'in_progress', 'blocked', 'on_hold', 'in_review'] as const;
const WORKERS: TaskRole[] = ['owner', 'manager', 'admin'];
const BOSSES: TaskRole[] = ['manager', 'admin'];

interface Rule {
  label: string;
  from: readonly TaskStatus[];
  to: TaskStatus | null;
  event: TaskEventKind;
  who: readonly TaskRole[];
  reason?: true;
}

export const ACTION_RULES: Record<TaskAction, Rule> = {
  acknowledge: {
    label: 'Acknowledge',
    from: NOT_CLOSED,
    to: null,
    event: 'acknowledged',
    who: ['owner'],
  },
  clarify: {
    label: 'Ask for clarification',
    from: NOT_CLOSED,
    to: null,
    event: 'clarification_requested',
    who: ['owner'],
    reason: true,
  },
  start: {
    label: 'Start work',
    from: ['pending'],
    to: 'in_progress',
    event: 'status_changed',
    who: WORKERS,
  },
  block: {
    label: 'Mark blocked',
    from: ['pending', 'in_progress', 'on_hold'],
    to: 'blocked',
    event: 'status_changed',
    who: WORKERS,
    reason: true,
  },
  hold: {
    label: 'Put on hold',
    from: ['pending', 'in_progress', 'blocked'],
    to: 'on_hold',
    event: 'status_changed',
    who: WORKERS,
    reason: true,
  },
  resume: {
    label: 'Resume work',
    from: ['blocked', 'on_hold'],
    to: 'in_progress',
    event: 'status_changed',
    who: WORKERS,
  },
  submit: {
    label: 'Submit for review',
    from: ['in_progress'],
    to: 'in_review',
    event: 'submitted_for_review',
    who: WORKERS,
  },
  approve: {
    label: 'Approve and close',
    from: ['in_review'],
    to: 'done',
    event: 'review_approved',
    who: ['reviewer', 'admin'],
  },
  request_changes: {
    label: 'Request changes',
    from: ['in_review'],
    to: 'in_progress',
    event: 'changes_requested',
    who: ['reviewer', 'admin'],
    reason: true,
  },
  complete: {
    label: 'Mark done',
    from: ['pending', 'in_progress', 'blocked', 'on_hold'],
    to: 'done',
    event: 'status_changed',
    who: WORKERS,
  },
  cancel: {
    label: 'Cancel task',
    from: NOT_CLOSED,
    to: 'cancelled',
    event: 'cancelled',
    who: ['creator', 'admin'],
    reason: true,
  },
  reopen: {
    label: 'Reopen',
    from: ['done', 'cancelled'],
    to: 'in_progress',
    event: 'reopened',
    who: WORKERS,
    reason: true,
  },
};

/**
 * R18: self-logged = logged by the owner's own user as `self` (recurring copies keep the parent's
 * source and creator), or imported while the owner is still the staff member the import batch was
 * mapped to. Never derived from the assigner, so a reassignment cannot make work self-logged.
 */
export const isSelfLogged = (
  t: { source: string; createdBy: string; staffId: string },
  ownerUserId: string | null,
  importStaffId: string | null = null,
) =>
  t.source === 'import'
    ? importStaffId === t.staffId
    : t.source === 'self' && !!ownerUserId && t.createdBy === ownerUserId;

/** R18: who may change the review step or reassign assigned work. */
export const GATE_ROLES: readonly TaskRole[] = ['creator', 'admin'];
export const REASSIGN_ROLES: readonly TaskRole[] = ['creator', 'manager', 'admin'];

export type Decision =
  | { ok: true; to: TaskStatus | null; event: TaskEventKind }
  | { ok: false; code: 'forbidden' | 'state' | 'reason'; message: string };

const who = (action: TaskAction, t: LifecycleTask, ctx: ActionContext): readonly TaskRole[] => {
  if (action === 'complete' && ctx.closedBy === 'manager') return BOSSES;
  if (action === 'cancel' && t.selfLogged) return ['owner', 'creator', 'admin'];
  return ACTION_RULES[action].who;
};

/** A-TSK-5: may these roles take this action on the task now? Role, then state, then reason. */
export function decide(
  action: TaskAction,
  t: LifecycleTask,
  ctx: ActionContext,
  reason?: string | null,
): Decision {
  const rule = ACTION_RULES[action];
  const no = (code: 'forbidden' | 'state' | 'reason', message: string): Decision => ({
    ok: false,
    code,
    message,
  });
  if (!who(action, t, ctx).some((r) => ctx.roles.includes(r)))
    return no('forbidden', `You cannot ${rule.label.toLowerCase()} on this task.`);
  if (!rule.from.includes(t.status))
    return no(
      'state',
      `“${rule.label}” is not possible while the task is ${t.status.replace('_', ' ')}.`,
    );
  if (action === 'acknowledge' && t.acknowledged) return no('state', 'Already acknowledged.');
  if (action === 'submit' && !t.reviewRequired)
    return no('state', 'This task has no review step: mark it done instead.');
  if (action === 'complete' && t.reviewRequired)
    return no('state', 'This task needs review: submit it for review.');
  if (rule.reason && !reason?.trim()) return no('reason', 'Give a reason.');
  return { ok: true, to: rule.to, event: rule.event };
}

export const allowedActions = (t: LifecycleTask, ctx: ActionContext): TaskAction[] =>
  TASK_ACTIONS.filter((a) => decide(a, t, ctx, 'reason').ok);

/** The action a status change in the generic edit stands for; review and cancel need their own actions. */
export function actionForStatus(
  from: TaskStatus,
  to: TaskStatus,
  reviewRequired: boolean,
): { action?: TaskAction; error?: string } {
  if (from === to) return {};
  if (to === 'in_review') return { error: 'Use “Submit for review”.' };
  if (to === 'cancelled') return { error: 'Use “Cancel task” and give a reason.' };
  if (to === 'pending') return { error: 'A started task cannot go back to Not started.' };
  if (to === 'blocked') return { action: 'block' };
  if (to === 'on_hold') return { action: 'hold' };
  if (to === 'done')
    return { action: reviewRequired && from === 'in_review' ? 'approve' : 'complete' };
  if (from === 'pending') return { action: 'start' };
  if (from === 'in_review') return { action: 'request_changes' };
  return { action: from === 'done' || from === 'cancelled' ? 'reopen' : 'resume' };
}

/** A-TSK-6: would "taskId waits on dependsOn" close a loop? `edges` are [task, dependsOn]. */
export function createsCycle(
  edges: readonly (readonly [string, string])[],
  taskId: string,
  dependsOn: string,
): boolean {
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === taskId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [a, b] of edges) if (a === node) stack.push(b);
  }
  return false;
}

export const isOpenStatus = (s: TaskStatus) => s !== 'done' && s !== 'cancelled';

export interface WorkEntry {
  id: string;
  occurredOn: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMinutes: number | null;
  correctsUpdateId: string | null;
}

/** A-TSK-7: entries that still count (a corrected entry is replaced by its correction). */
export const currentEntries = <T extends WorkEntry>(entries: readonly T[]): T[] => {
  const corrected = new Set(entries.map((e) => e.correctsUpdateId).filter(Boolean));
  return entries.filter((e) => !corrected.has(e.id));
};

/** Recorded minutes: the stated duration, else the start/stop interval; null when neither. */
export const minutesOf = (e: WorkEntry): number | null =>
  e.durationMinutes ??
  (e.startedAt && e.endedAt ? Math.round((+e.endedAt - +e.startedAt) / 60000) : null);

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const clock = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Warnings for a new entry: overlaps with the author's same-day entries, midnight crossing. Never corrected. */
export function overlapWarnings(entry: WorkEntry, sameDay: readonly WorkEntry[]): string[] {
  const out: string[] = [];
  const { startedAt: s, endedAt: e } = entry;
  if (s && e) {
    for (const o of currentEntries(sameDay))
      if (o.id !== entry.id && o.startedAt && o.endedAt && s < o.endedAt && o.startedAt < e)
        out.push(
          `Overlaps another entry on this day (${clock.format(o.startedAt)}–${clock.format(o.endedAt)} IST).`,
        );
    if (istToday(s) !== istToday(e))
      out.push(`Crosses midnight IST; counted on the work date ${day(entry.occurredOn)}.`);
  }
  return out;
}

const WAITING: readonly TaskStatus[] = ['blocked', 'on_hold', 'in_review'];

export interface StatusPoint {
  occurredAt: Date;
  toStatus: TaskStatus | null;
  reason: string | null;
}

/**
 * Elapsed time (received → closed, or now), waiting intervals (blocked, on hold, in review) from
 * the dated status events, and recorded work time (sum of current entries; null = none recorded).
 * Elapsed days are not effort hours.
 */
export function taskTimeSummary(
  events: readonly StatusPoint[],
  entries: readonly WorkEntry[],
  receivedAt: Date,
  now: Date,
) {
  const steps = events.filter((e) => e.toStatus).sort((a, b) => +a.occurredAt - +b.occurredAt);
  const last = steps.at(-1);
  const end = last && !isOpenStatus(last.toStatus!) ? last.occurredAt : now;
  const waits = steps
    .map((s, i) => ({
      status: s.toStatus!,
      from: s.occurredAt,
      to: steps[i + 1]?.occurredAt ?? end,
      reason: s.reason,
    }))
    .filter((w) => WAITING.includes(w.status));
  const minutes = currentEntries(entries)
    .map(minutesOf)
    .filter((m): m is number => m !== null);
  const span = (a: Date, b: Date) => Math.max(0, Math.round((+b - +a) / 60000));
  return {
    elapsedMinutes: span(receivedAt, end),
    waitingMinutes: waits.reduce((n, w) => n + span(w.from, w.to), 0),
    recordedMinutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) : null,
    waits,
  };
}
