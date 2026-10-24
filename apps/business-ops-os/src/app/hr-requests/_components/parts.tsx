/**
 * Pieces shared by the staff side (`<base>/hr-requests`) and the HR queue (`/ops/hr/requests`):
 * status and urgency badges, the routing log as a timeline, and the facts of a request.
 */
import { StatusBadge } from '@elevate/shared-ui';
import {
  HR_REQUEST_STATUS_LABELS,
  HR_REQUEST_URGENCIES,
  HR_REQUEST_URGENCY_LABELS,
  type HrRequestStatus,
  type HrRequestUrgency,
} from '../../../domain/hr-requests';
import { istWhen } from '../../../domain/staff-tasks';
import type { HrRequestView } from '../../../server/hr-requests-read';
import { DetailTable, Timeline } from '../../../ui/sections';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_TONE: Record<HrRequestStatus, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  reviewed: 'info',
  forwarded: 'warning',
  resolved: 'success',
  declined: 'neutral',
};
const URGENCY_TONE: Record<HrRequestUrgency, Tone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

export const URGENCY_OPTIONS = HR_REQUEST_URGENCIES.map((u) => ({
  value: u,
  label: HR_REQUEST_URGENCY_LABELS[u],
}));

export const RequestStatus = ({ status }: { status: HrRequestStatus }) => (
  <StatusBadge tone={STATUS_TONE[status]}>{HR_REQUEST_STATUS_LABELS[status]}</StatusBadge>
);
export const Urgency = ({ urgency }: { urgency: HrRequestUrgency }) => (
  <StatusBadge tone={URGENCY_TONE[urgency]}>{HR_REQUEST_URGENCY_LABELS[urgency]}</StatusBadge>
);
export const Unresolved = ({ note }: { note: string | null }) =>
  note ? <StatusBadge tone="warning">{note}</StatusBadge> : null;

type Event = HrRequestView['events'][number];
const TITLES: Record<Event['kind'], (e: Event, hr: boolean) => string> = {
  submitted: () => 'Sent to HR',
  reviewed: () => 'Reviewed by HR',
  forwarded: (e, hr) =>
    hr ? `Forwarded to ${e.forwardedToName ?? 'a staff member'}` : 'Forwarded by HR',
  resolved: () => 'Resolved',
  declined: () => 'Declined',
  recipient_responded: (e, hr) => (hr ? `Reply from ${e.actorName}` : 'Your reply to HR'),
  response_relayed: (_e, hr) => (hr ? 'Answer passed on to the sender' : 'Answer from HR'),
  note: () => 'HR note',
  task_created: (e) => `Task created: ${e.body ?? ''}`,
};

/** The routing log as this viewer may see it, newest first. HR also sees its notes and who saw what. */
export function RequestTimeline({ view }: { view: HrRequestView }) {
  const hr = view.as === 'hr';
  if (!view.events.length) return <p className="el-field-hint">Nothing has happened yet.</p>;
  return (
    <Timeline
      label="What happened"
      items={[...view.events].reverse().map((e) => ({
        key: e.id,
        when: istWhen(e.createdAt),
        title: `${TITLES[e.kind](e, hr)}${hr ? ` · ${e.actorName ?? 'Someone'}` : ''}`,
        detail: (
          <>
            {e.body && e.kind !== 'task_created' ? <span className="el-pre">{e.body}</span> : null}
            {hr && e.hrNote ? <em> HR note (only HR sees this): {e.hrNote}</em> : null}
          </>
        ),
      }))}
    />
  );
}

/** The request's facts for its sender and for HR (never shown to a recipient). */
export function RequestFacts({
  view,
  base,
}: {
  view: HrRequestView;
  /** Workspace basePath, for links to a linked task. */
  base: string;
}) {
  const r = view.request;
  if (!r) return null;
  const related =
    r.relatedKind === 'none' ? null : r.relatedKind === 'task' ? (
      <a href={`${base}/tasks/${r.relatedId}`}>Open the task</a>
    ) : r.relatedKind === 'student' && view.as === 'hr' ? (
      <a href={`/ops/students?open=${r.relatedId}`}>Open the student</a>
    ) : (
      `${r.relatedKind.charAt(0).toUpperCase()}${r.relatedKind.slice(1)} (in its own workspace)`
    );
  return (
    <DetailTable
      rows={[
        { label: 'Status', value: <RequestStatus status={r.status} /> },
        view.as === 'hr' && { label: 'From', value: r.senderName },
        {
          label: 'For',
          value: (
            <>
              {r.recipient.label} <Unresolved note={r.recipient.unresolved} />
            </>
          ),
        },
        { label: 'Category', value: view.categoryLabel },
        { label: 'Urgency', value: <Urgency urgency={r.urgency} /> },
        { label: 'Sent', value: r.submittedAt ? istWhen(r.submittedAt) : 'Not sent yet (draft)' },
        related && { label: 'About', value: related },
        r.linkedTaskId && {
          label: 'Task from this request',
          value: <a href={`${base}/tasks/${r.linkedTaskId}`}>Open the task</a>,
        },
      ]}
    />
  );
}
