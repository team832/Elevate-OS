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

// --- comments (OPS-060) ---------------------------------------------------------------------------

export const TASK_COMMENT_MAX_LENGTH = 4000;

export type CommentHideCheck =
  | { ok: true }
  | { ok: false; code: 'ALREADY_HIDDEN' | 'NOT_ALLOWED' | 'REASON_REQUIRED'; message: string };

/**
 * Comments are append-only: the body is never edited. Hiding ("deleting") is
 * allowed for the author or an operations manager (all-scope task writer), needs
 * a reason, and happens at most once.
 */
export function checkCommentHide(input: {
  actorUserId: string;
  authorUserId: string;
  actorIsManager: boolean;
  alreadyHidden: boolean;
  reason: string | null | undefined;
}): CommentHideCheck {
  if (input.alreadyHidden)
    return { ok: false, code: 'ALREADY_HIDDEN', message: 'This comment is already hidden.' };
  if (input.actorUserId !== input.authorUserId && !input.actorIsManager)
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: 'Only the author or an operations manager can hide a comment.',
    };
  if (blank(input.reason))
    return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for hiding the comment.' };
  return { ok: true };
}

// --- supervisor review (OPS-062) ------------------------------------------------------------------

export const TASK_REVIEW_STATUSES = ['pending', 'accepted', 'returned'] as const;
export type TaskReviewStatus = (typeof TASK_REVIEW_STATUSES)[number];

export type TaskReviewState =
  'not_required' | 'required_not_submitted' | 'awaiting_review' | 'accepted' | 'returned';

export const TASK_REVIEW_STATE_LABELS: Record<TaskReviewState, string> = {
  not_required: 'No review required',
  required_not_submitted: 'Review required on completion',
  awaiting_review: 'Completed — awaiting supervisor review',
  accepted: 'Review accepted',
  returned: 'Returned by the reviewer',
};

/**
 * Derived review state. The task keeps its BR-OPS-10 status; "awaiting review"
 * is a completed task whose latest review cycle is pending.
 */
export function taskReviewState(input: {
  required: boolean;
  latest: { status: TaskReviewStatus } | null;
}): TaskReviewState {
  if (input.latest?.status === 'pending') return 'awaiting_review';
  if (!input.latest) return input.required ? 'required_not_submitted' : 'not_required';
  return input.latest.status === 'accepted' ? 'accepted' : 'returned';
}

export interface TaskReviewDecisionInput {
  status: TaskReviewStatus;
  decision: 'accept' | 'return';
  note?: string | null;
  deciderUserId: string;
  submitterUserId: string;
  /** Login of the task owner (responsible), if any. */
  ownerUserId: string | null;
  /** Login of the named reviewer, if one is named. */
  reviewerUserId: string | null;
  /** Login of the accountable owner, if any. */
  accountableUserId: string | null;
  /** Holds all-scope `ops:tasks:write` (operations manager). */
  deciderIsManager: boolean;
}

export type TaskReviewDecisionCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'NOT_PENDING' | 'SELF_REVIEW' | 'OWNER_REVIEW' | 'NOT_REVIEWER' | 'NOTE_REQUIRED';
      message: string;
    };

/** True when this user may decide the review (before the self-review rules). */
export function isAllowedTaskReviewer(
  input: Pick<
    TaskReviewDecisionInput,
    'deciderUserId' | 'reviewerUserId' | 'accountableUserId' | 'deciderIsManager'
  >,
): boolean {
  if (input.deciderIsManager) return true;
  if (input.reviewerUserId) return input.reviewerUserId === input.deciderUserId;
  return input.accountableUserId !== null && input.accountableUserId === input.deciderUserId;
}

/**
 * Review rules: only a pending review can be decided; the person who completed
 * the task and the task owner can never review it (no self-approval); the
 * decider is the named reviewer, else the accountable owner, or an operations
 * manager; returning needs a note (it reopens the task).
 */
export function checkTaskReviewDecision(input: TaskReviewDecisionInput): TaskReviewDecisionCheck {
  if (input.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: `This review is already ${input.status}.` };
  if (input.deciderUserId === input.submitterUserId)
    return {
      ok: false,
      code: 'SELF_REVIEW',
      message: 'You completed this task, so someone else must review it.',
    };
  if (input.ownerUserId && input.deciderUserId === input.ownerUserId)
    return {
      ok: false,
      code: 'OWNER_REVIEW',
      message: 'The task owner cannot review their own task.',
    };
  if (!isAllowedTaskReviewer(input))
    return {
      ok: false,
      code: 'NOT_REVIEWER',
      message:
        'Only the named reviewer, the accountable owner or an operations manager can review this task.',
    };
  if (input.decision === 'return' && blank(input.note))
    return {
      ok: false,
      code: 'NOTE_REQUIRED',
      message: 'Say what needs to change before the task is completed again.',
    };
  return { ok: true };
}

// --- reminders and overdue handling (OPS-063) -----------------------------------------------------

export interface TaskReminderSettings {
  /** Remind the owner this many calendar days before the due date (0 = on the due date only). */
  leadDays: number;
  /** Also notify the backup owner when a task becomes overdue. */
  notifyBackupWhenOverdue: boolean;
}

export const DEFAULT_TASK_REMINDER_SETTINGS: TaskReminderSettings = {
  leadDays: 1,
  notifyBackupWhenOverdue: true,
};

export type TaskReminderKind = 'due_soon' | 'overdue';

/**
 * Reminders to send now for one task. `due_soon`: open, due within `leadDays`
 * days (today counts). `overdue`: open and the due date has passed. Each kind is
 * sent once per due date (a changed due date can be reminded again); tasks
 * without a due date never get reminders (they are flagged `missing_due`).
 */
export function taskRemindersDue(
  task: { status: TaskStatus; dueDate: IsoDate | null },
  now: Date,
  settings: TaskReminderSettings,
  alreadySent: readonly { kind: string; dueDate: string }[],
): TaskReminderKind[] {
  if (!isOpenTask(task.status) || !task.dueDate) return [];
  const sent = (kind: TaskReminderKind) =>
    alreadySent.some((s) => s.kind === kind && s.dueDate === task.dueDate);
  const daysUntil = daysBetween(istToday(now), task.dueDate);
  if (daysUntil < 0) return sent('overdue') ? [] : ['overdue'];
  if (daysUntil <= Math.max(0, settings.leadDays) && !sent('due_soon')) return ['due_soon'];
  return [];
}

// --- activity history (OPS-060) -------------------------------------------------------------------

export type TaskActivityKind =
  | 'created'
  | 'status'
  | 'reassignment'
  | 'edit'
  | 'dependency'
  | 'comment'
  | 'reference'
  | 'escalation'
  | 'review'
  | 'reminder'
  | 'other';

export interface TaskAuditLike {
  action: string;
  before: unknown;
  after: unknown;
  metadata?: unknown;
}

const PEOPLE_FIELDS = [
  ['ownerStaffId', 'owner'],
  ['accountableStaffId', 'accountable owner'],
  ['backupStaffId', 'backup'],
] as const;
const EDIT_FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  dueDate: 'due date',
  priority: 'priority',
  departmentId: 'department',
  leadId: 'lead link',
  admissionId: 'admission link',
  sopId: 'SOP link',
  decisionId: 'decision link',
  projectId: 'project link',
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const statusLabel = (v: unknown) =>
  typeof v === 'string' && v in TASK_STATUS_LABELS ? TASK_STATUS_LABELS[v as TaskStatus] : str(v);

/**
 * One line of the task activity panel from an audit event (pure). `nameOf`
 * resolves staff ids to names (null = unknown / none).
 */
export function describeTaskActivity(
  event: TaskAuditLike,
  nameOf: (staffId: string) => string | null,
): { kind: TaskActivityKind; summary: string } {
  const before = rec(event.before);
  const after = rec(event.after);
  const meta = rec(event.metadata);
  const person = (v: unknown) =>
    typeof v === 'string' && v ? (nameOf(v) ?? 'unknown person') : 'nobody';
  switch (event.action) {
    case 'task.created':
      return { kind: 'created', summary: 'Task created.' };
    case 'task.updated': {
      const moves = PEOPLE_FIELDS.filter(([f]) => (before[f] ?? null) !== (after[f] ?? null)).map(
        ([f, label]) => `${label}: ${person(before[f])} → ${person(after[f])}`,
      );
      if (moves.length)
        return { kind: 'reassignment', summary: `Reassigned — ${moves.join('; ')}.` };
      const edited = Object.keys(EDIT_FIELD_LABELS).filter(
        (f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null),
      );
      return {
        kind: 'edit',
        summary: edited.length
          ? `Edited ${edited.map((f) => EDIT_FIELD_LABELS[f]).join(', ')}.`
          : 'Edited.',
      };
    }
    case 'task.status_changed':
    case 'task.completed_with_override': {
      const reason = str(after.reason) ? ` Reason: ${str(after.reason)}` : '';
      const override =
        event.action === 'task.completed_with_override'
          ? ` Completed despite open blockers (${str(after.override)}).`
          : '';
      return {
        kind: 'status',
        summary: `Status ${statusLabel(before.status)} → ${statusLabel(after.status)}.${reason}${override}`,
      };
    }
    case 'task.dependency_added':
      return { kind: 'dependency', summary: `Now blocked by ${str(after.blockedBy) || 'a task'}.` };
    case 'task.dependency_removed':
      return { kind: 'dependency', summary: 'A blocking dependency was removed.' };
    case 'task.escalated':
      return {
        kind: 'escalation',
        summary: `Escalated to L${str(after.level ?? meta.level) || '?'}: ${str(after.reason)}`,
      };
    case 'escalation.acknowledged':
      return {
        kind: 'escalation',
        summary: `L${str(after.level) || '?'} escalation acknowledged.`,
      };
    case 'escalation.resolved':
      return {
        kind: 'escalation',
        summary: `L${str(after.level) || '?'} escalation resolved${str(after.resolutionNote) ? `: ${str(after.resolutionNote)}` : '.'}`,
      };
    case 'task.comment_added':
      return { kind: 'comment', summary: 'Comment added.' };
    case 'task.comment_hidden':
      return {
        kind: 'comment',
        summary: `A comment was hidden. Reason: ${str(after.hiddenReason)}`,
      };
    case 'task.reference_added':
      return { kind: 'reference', summary: `Reference added: ${str(after.label)}.` };
    case 'task.reference_removed':
      return {
        kind: 'reference',
        summary: `Reference removed: ${str(after.label)}. Reason: ${str(after.removedReason)}`,
      };
    case 'task.review_required':
      return { kind: 'review', summary: 'Supervisor review required on completion.' };
    case 'task.review_requirement_removed':
      return { kind: 'review', summary: 'Supervisor review requirement removed.' };
    case 'task.review_submitted':
      return {
        kind: 'review',
        summary: `Submitted for supervisor review (cycle ${str(after.cycle) || '?'}).`,
      };
    case 'task.review_accepted':
      return { kind: 'review', summary: 'Supervisor review accepted the completion.' };
    case 'task.review_returned':
      return {
        kind: 'review',
        summary: `Returned by the reviewer and reopened: ${str(after.decisionNote)}`,
      };
    case 'task.reminder_sent':
      return {
        kind: 'reminder',
        summary:
          after.kind === 'overdue'
            ? `Overdue reminder sent (due ${str(after.dueDate)}).`
            : `Due-soon reminder sent (due ${str(after.dueDate)}).`,
      };
    default:
      return { kind: 'other', summary: event.action };
  }
}
