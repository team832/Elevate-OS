/**
 * Task lifecycle, dependencies and work time (owner brief 23 Oct 2026 §9–§10, rulings R4/R5;
 * brief 2 §5, §6, §12). Pure. Algorithms: A-TSK-5 actions and transitions, A-TSK-6 dependency
 * cycles, A-TSK-7 work entries and time. Draft → Assigned (pending) → In progress → Submitted
 * (in_review) → Approved (done), plus Changes requested and Cancelled. Acknowledgement and the
 * blocked flag never change the status; overdue is computed (staff-tasks.ts).
 */
import type { TaskEventKind, TaskStatus } from './staff-tasks';

export * from './task-time';

export const TASK_ACTIONS = [
  'publish',
  'acknowledge',
  'clarify',
  'start',
  'block',
  'hold',
  'resume',
  'submit',
  'approve',
  'request_changes',
  'comment',
  'complete',
  'cancel',
  'reopen',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * owner = accountable staff; manager = up the owner's manager chain; admin = all-scope write
 * (neither manager nor admin on a task you own or back up);
 * reviewer = the named reviewer or a holder of ops:tasks:review covering the owner;
 * creator = the user who logged the task (R18: the gate and cancel of assigned work are theirs);
 * collaborator = named on a task shared with collaborators (reads; comments only when the
 * setting tasks.peer_discussion is `allowed`).
 */
export type TaskRole = 'owner' | 'manager' | 'admin' | 'reviewer' | 'creator' | 'collaborator';

export interface LifecycleTask {
  status: TaskStatus;
  reviewRequired: boolean;
  acknowledged: boolean;
  /** Blocked or on hold (a flag with a reason, R4). */
  blocked: boolean;
  /** Logged by its owner for themselves (R18, fixed at creation): the owner may cancel it. */
  selfLogged: boolean;
}
export interface ActionContext {
  roles: readonly TaskRole[];
  /** Setting tasks.completion_without_reviewer (proposed). */
  closedBy: 'owner' | 'manager';
  /** Setting tasks.reopen_roles (proposed) applied to this caller and task. */
  mayReopenApproved?: boolean;
  /** Setting tasks.peer_discussion (owner-approved 23 Oct 2026); unset = hr_and_reviewer_only. */
  peerDiscussion?: 'hr_and_reviewer_only' | 'allowed';
}

/** Work still with the assignee; `in_review` waits on the reviewer. */
const WORK = ['pending', 'in_progress', 'changes_requested'] as const;
const OPEN = [...WORK, 'in_review'] as const;
const WORKERS: TaskRole[] = ['owner', 'manager', 'admin'];
const BOSSES: TaskRole[] = ['manager', 'admin'];
const REVIEWERS: TaskRole[] = ['reviewer', 'admin'];

interface Rule {
  label: string;
  from: readonly TaskStatus[];
  to: TaskStatus | null;
  event: TaskEventKind;
  who: readonly TaskRole[];
  reason?: true;
}

export const ACTION_RULES: Record<TaskAction, Rule> = {
  publish: {
    label: 'Assign now',
    from: ['draft'],
    to: 'pending',
    event: 'status_changed',
    who: ['creator', 'manager', 'admin'],
  },
  acknowledge: {
    label: 'Acknowledge',
    from: OPEN,
    to: null,
    event: 'acknowledged',
    who: ['owner'],
  },
  clarify: {
    label: 'Ask for clarification',
    from: OPEN,
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
    from: WORK,
    to: null,
    event: 'blocked_set',
    who: WORKERS,
    reason: true,
  },
  hold: {
    label: 'Put on hold',
    from: WORK,
    to: null,
    event: 'blocked_set',
    who: WORKERS,
    reason: true,
  },
  resume: { label: 'Clear blocker', from: WORK, to: null, event: 'blocked_cleared', who: WORKERS },
  submit: {
    label: 'Submit for review',
    from: ['in_progress', 'changes_requested'],
    to: 'in_review',
    event: 'submitted_for_review',
    who: WORKERS,
  },
  approve: {
    label: 'Approve',
    from: ['in_review'],
    to: 'done',
    event: 'review_approved',
    who: REVIEWERS,
  },
  request_changes: {
    label: 'Request changes',
    from: ['in_review'],
    to: 'changes_requested',
    event: 'changes_requested',
    who: REVIEWERS,
    reason: true,
  },
  comment: {
    label: 'Comment',
    from: ['draft', ...OPEN, 'done', 'cancelled'],
    to: null,
    event: 'comment',
    who: ['owner', 'manager', 'admin', 'reviewer', 'creator', 'collaborator'],
    reason: true,
  },
  complete: {
    label: 'Mark done',
    from: WORK,
    to: 'done',
    event: 'status_changed',
    who: WORKERS,
  },
  cancel: {
    label: 'Cancel task',
    from: ['draft', ...OPEN],
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
/** Who may change the brief of assigned work (title, deliverable, criteria, links, reviewer, deadline). */
export const BRIEF_ROLES: readonly TaskRole[] = ['creator', 'manager', 'admin'];
export const REASSIGN_ROLES: readonly TaskRole[] = ['creator', 'manager', 'admin'];

export type Decision =
  | { ok: true; to: TaskStatus | null; event: TaskEventKind }
  | { ok: false; code: 'forbidden' | 'state' | 'reason'; message: string };

const isApproved = (t: LifecycleTask) => t.status === 'done' && t.reviewRequired;

const allowedBy = (action: TaskAction, t: LifecycleTask, ctx: ActionContext) => {
  if (action === 'reopen' && isApproved(t)) return !!ctx.mayReopenApproved;
  // A cancelled task comes back only through whoever could cancel it.
  const cancelWho = t.selfLogged ? ['owner', 'creator', 'manager', 'admin'] : BRIEF_ROLES;
  const who =
    action === 'complete' && ctx.closedBy === 'manager'
      ? BOSSES
      : action === 'cancel' && t.selfLogged
        ? ['owner', 'creator', 'admin']
        : action === 'reopen' && t.status === 'cancelled'
          ? cancelWho
          : action === 'comment' && ctx.peerDiscussion !== 'allowed'
            ? ACTION_RULES.comment.who.filter((r) => r !== 'collaborator')
            : ACTION_RULES[action].who;
  return who.some((r) => ctx.roles.includes(r as TaskRole));
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
  if (!allowedBy(action, t, ctx))
    return no('forbidden', `You cannot ${rule.label.toLowerCase()} on this task.`);
  if (!rule.from.includes(t.status))
    return no('state', `“${rule.label}” is not possible while the task is ${statusWords(t)}.`);
  if (action === 'acknowledge' && t.acknowledged) return no('state', 'Already acknowledged.');
  if ((action === 'block' || action === 'hold') && t.blocked)
    return no('state', 'Already blocked: clear the blocker first.');
  if (action === 'resume' && !t.blocked) return no('state', 'Nothing is blocking this task.');
  if ((action === 'submit' || action === 'complete') && t.blocked)
    return no('state', 'Clear the blocker before finishing the task.');
  if (action === 'submit' && !t.reviewRequired)
    return no('state', 'This task has no review step: mark it done instead.');
  if (action === 'complete' && t.reviewRequired)
    return no('state', 'This task needs review: submit it for review.');
  if (rule.reason && !reason?.trim()) return no('reason', 'Give a reason.');
  return { ok: true, to: rule.to, event: rule.event };
}

const statusWords = (t: LifecycleTask) =>
  ({
    draft: 'a draft',
    pending: 'assigned',
    in_progress: 'in progress',
    in_review: 'submitted',
    changes_requested: 'waiting for changes',
    done: t.reviewRequired ? 'approved' : 'done',
    cancelled: 'cancelled',
  })[t.status];

export const allowedActions = (t: LifecycleTask, ctx: ActionContext): TaskAction[] =>
  TASK_ACTIONS.filter((a) => decide(a, t, ctx, 'reason').ok);

/**
 * The one next step for the assignee (My Tasks): acknowledge, start, submit (or respond to
 * changes), mark done, or clear the blocker; null while it waits on someone else or is closed.
 */
export function nextAction(
  t: LifecycleTask,
  closedBy: ActionContext['closedBy'] = 'owner',
): { action: TaskAction; label: string } | null {
  if (!(WORK as readonly string[]).includes(t.status) && t.status !== 'in_review') return null;
  if (!t.acknowledged) return { action: 'acknowledge', label: 'Acknowledge' };
  if (t.status === 'in_review') return null;
  if (t.blocked) return { action: 'resume', label: 'Clear blocker' };
  if (t.status === 'pending') return { action: 'start', label: 'Start' };
  if (!t.reviewRequired)
    return closedBy === 'owner' ? { action: 'complete', label: 'Mark done' } : null;
  return t.status === 'changes_requested'
    ? { action: 'submit', label: 'Respond to changes' }
    : { action: 'submit', label: 'Submit' };
}
