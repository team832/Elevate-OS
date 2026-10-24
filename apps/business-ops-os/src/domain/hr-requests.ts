/**
 * Requests sent through HR (owner brief 23 Oct 2026 §6), the only staff-to-staff channel. Pure.
 * Draft → Submitted to HR → Reviewed → Forwarded | Resolved | Declined; a forwarded request ends
 * Resolved once HR has relayed the answer. The sender's subject and message are fixed once
 * submitted. A recipient never answers the sender directly: their reply goes to HR, which relays it.
 */

export const HR_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'reviewed',
  'forwarded',
  'resolved',
  'declined',
] as const;
export type HrRequestStatus = (typeof HR_REQUEST_STATUSES)[number];
export const HR_REQUEST_STATUS_LABELS: Record<HrRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted to HR',
  reviewed: 'Reviewed',
  forwarded: 'Forwarded',
  resolved: 'Resolved',
  declined: 'Declined',
};

export const HR_REQUEST_URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;
export type HrRequestUrgency = (typeof HR_REQUEST_URGENCIES)[number];
export const HR_REQUEST_URGENCY_LABELS: Record<HrRequestUrgency, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** What a request may be about; `none` = nothing linked. */
export const HR_REQUEST_RELATED_KINDS = [
  'task',
  'batch',
  'campaign',
  'student',
  'test',
  'none',
] as const;
export type HrRequestRelatedKind = (typeof HR_REQUEST_RELATED_KINDS)[number];

export type HrRequestEventKind =
  | 'submitted'
  | 'reviewed'
  | 'forwarded'
  | 'resolved'
  | 'declined'
  | 'recipient_responded'
  | 'response_relayed'
  | 'note'
  | 'task_created';

export const HR_REQUEST_ACTIONS = [
  'submit',
  'review',
  'forward',
  'resolve',
  'decline',
  'relay',
  'respond',
  'note',
  'create_task',
] as const;
export type HrRequestAction = (typeof HR_REQUEST_ACTIONS)[number];

/** sender = whoever sent it; hr = ops:hr_requests:manage covering the sender; recipient = forwarded to. */
export type HrRequestRole = 'sender' | 'hr' | 'recipient';

interface Rule {
  label: string;
  from: readonly HrRequestStatus[];
  to: HrRequestStatus | null;
  who: HrRequestRole;
  event: HrRequestEventKind;
  /** The action carries text: what the recipient sees, the reason, the answer. */
  body?: true;
}

const OPEN: HrRequestStatus[] = ['submitted', 'reviewed', 'forwarded'];
export const HR_REQUEST_RULES: Record<HrRequestAction, Rule> = {
  submit: {
    label: 'Send to HR',
    from: ['draft'],
    to: 'submitted',
    who: 'sender',
    event: 'submitted',
  },
  review: {
    label: 'Mark reviewed',
    from: ['submitted'],
    to: 'reviewed',
    who: 'hr',
    event: 'reviewed',
  },
  forward: {
    label: 'Forward',
    from: ['reviewed', 'forwarded'],
    to: 'forwarded',
    who: 'hr',
    event: 'forwarded',
    body: true,
  },
  resolve: {
    label: 'Resolve',
    from: ['reviewed', 'forwarded'],
    to: 'resolved',
    who: 'hr',
    event: 'resolved',
  },
  decline: {
    label: 'Decline',
    from: ['reviewed'],
    to: 'declined',
    who: 'hr',
    event: 'declined',
    body: true,
  },
  relay: {
    label: 'Relay the answer',
    from: ['forwarded'],
    to: null,
    who: 'hr',
    event: 'response_relayed',
    body: true,
  },
  respond: {
    label: 'Reply to HR',
    from: ['forwarded'],
    to: null,
    who: 'recipient',
    event: 'recipient_responded',
    body: true,
  },
  note: {
    label: 'Add an HR note',
    from: [...OPEN, 'resolved', 'declined'],
    to: null,
    who: 'hr',
    event: 'note',
    body: true,
  },
  create_task: {
    label: 'Create a task',
    from: OPEN,
    to: null,
    who: 'hr',
    event: 'task_created',
  },
};

export type HrRequestDecision =
  | { ok: true; to: HrRequestStatus | null; event: HrRequestEventKind }
  | { ok: false; code: 'forbidden' | 'state' | 'body'; message: string };

/** May someone holding `roles` take `action` on a request in `status` now? Role, state, then text. */
export function decideHrRequest(
  action: HrRequestAction,
  status: HrRequestStatus,
  roles: readonly HrRequestRole[],
  body?: string | null,
): HrRequestDecision {
  const rule = HR_REQUEST_RULES[action];
  if (!roles.includes(rule.who))
    return {
      ok: false,
      code: 'forbidden',
      message: `You cannot ${rule.label.toLowerCase()} here.`,
    };
  if (!rule.from.includes(status))
    return {
      ok: false,
      code: 'state',
      message: `“${rule.label}” is not possible while the request is ${HR_REQUEST_STATUS_LABELS[status].toLowerCase()}.`,
    };
  if (rule.body && !body?.trim()) return { ok: false, code: 'body', message: 'Write the text.' };
  return { ok: true, to: rule.to, event: rule.event };
}

/** The sender's subject, message, category, recipient and link change only while a draft. */
export const isEditable = (status: HrRequestStatus) => status === 'draft';

/** HR queue tabs; counts and rows come from one query. */
export const HR_QUEUE_TABS = [
  { key: 'new', label: 'New', statuses: ['submitted'] },
  { key: 'review', label: 'In review', statuses: ['reviewed'] },
  { key: 'forwarded', label: 'Forwarded', statuses: ['forwarded'] },
  { key: 'closed', label: 'Closed', statuses: ['resolved', 'declined'] },
] as const satisfies readonly { key: string; label: string; statuses: HrRequestStatus[] }[];
export type HrQueueTab = (typeof HR_QUEUE_TABS)[number]['key'];

/** `schar` → "Schar", `academic_head` → "Academic head". */
export const recipientKeyLabel = (key: string) =>
  key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

/**
 * Who a request is meant for. A configured key (setting hr.request_recipients) resolves only to
 * the staff member the setting names, and only while that person is active; otherwise it is
 * unresolved and the request waits in HR's queue. Nothing is guessed.
 */
export function resolveRecipient(
  r: { recipientStaffId: string | null; recipientKey: string | null },
  recipients: Readonly<Record<string, string | null>>,
  isActive: (staffId: string) => boolean,
):
  | { kind: 'hr' }
  | { kind: 'staff'; staffId: string }
  | { kind: 'unresolved'; key: string; note: string } {
  if (r.recipientStaffId) return { kind: 'staff', staffId: r.recipientStaffId };
  if (!r.recipientKey) return { kind: 'hr' };
  const staffId = recipients[r.recipientKey] ?? null;
  return staffId && isActive(staffId)
    ? { kind: 'staff', staffId }
    : {
        kind: 'unresolved',
        key: r.recipientKey,
        note: `Recipient not set up: ${recipientKeyLabel(r.recipientKey)}`,
      };
}

export interface HrEventView {
  kind: HrRequestEventKind;
  actorUserId: string;
  forwardedToStaffId: string | null;
  visibleToRecipient: boolean;
  hrNote: string | null;
  body: string | null;
}

/** Events whose text the sender is shown: HR's decision, the reason and the relayed answer. */
const SENDER_TEXT: readonly HrRequestEventKind[] = ['declined', 'resolved', 'response_relayed'];
/** Events the sender sees at all (never HR notes, the forwarded text or the recipient's reply). */
const SENDER_EVENTS: readonly HrRequestEventKind[] = [
  'submitted',
  'reviewed',
  'forwarded',
  ...SENDER_TEXT,
];

/**
 * What one viewer may see of the routing log. HR sees everything. The sender sees the steps and
 * only the text meant for them. A recipient sees only what was forwarded to them and marked
 * visible, plus their own replies: visibility is per recipient, never per request.
 */
export function eventsFor<E extends HrEventView>(
  viewer: { as: 'hr' } | { as: 'sender' } | { as: 'recipient'; staffId: string; userId: string },
  events: readonly E[],
): E[] {
  if (viewer.as === 'hr') return [...events];
  if (viewer.as === 'sender')
    return events
      .filter((e) => SENDER_EVENTS.includes(e.kind))
      .map((e) => ({
        ...e,
        hrNote: null,
        forwardedToStaffId: null,
        body: SENDER_TEXT.includes(e.kind) ? e.body : null,
      }));
  return events
    .filter(
      (e) =>
        (e.kind === 'forwarded' &&
          e.visibleToRecipient &&
          e.forwardedToStaffId === viewer.staffId) ||
        (e.kind === 'recipient_responded' && e.actorUserId === viewer.userId),
    )
    .map((e) => ({ ...e, hrNote: null }));
}
