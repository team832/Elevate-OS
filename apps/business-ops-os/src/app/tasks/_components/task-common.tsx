/**
 * Small task pieces shared by My Tasks, the tracker, HR's task pages and the detail page:
 * paths under the host's basePath (D-073), status badges in R4 words, deadline text in IST and
 * the one next action for the assignee (brief §18).
 */
import { ButtonLink, StatusBadge } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import {
  deadlineText,
  isOverdue,
  istWhen,
  taskStatusLabel,
  TASK_PRIORITIES,
  type TaskBlockKind,
  type TaskEventStatus,
  type TaskStatus,
} from '../../../domain/staff-tasks';
import { ACTION_RULES, nextAction } from '../../../domain/task-lifecycle';
import { ACTION_SLUG } from '../../../server/staff-tasks-schemas';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate } from '../../../ui/format';

export type Params = Record<string, string | undefined>;
/** Task screens and APIs under the host app's basePath ('/ops', '/academic', '/marketing'; D-073). */
export const taskPaths = (base: string) => ({
  tasks: `${base}/tasks`,
  api: `${base}/api/v1/staff-tasks`,
  eodApi: `${base}/api/v1/eod-reports`,
});

const TONES: Record<TaskEventStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending: 'neutral',
  in_progress: 'info',
  in_review: 'info',
  changes_requested: 'warning',
  done: 'success',
  cancelled: 'neutral',
  blocked: 'danger',
  on_hold: 'warning',
};

export const TaskBadge = ({
  status,
  overdue,
  reviewRequired,
  blocked,
}: {
  status: TaskEventStatus;
  overdue?: boolean;
  reviewRequired?: boolean;
  blocked?: TaskBlockKind | null;
}) => (
  <>
    <StatusBadge tone={TONES[status]}>{taskStatusLabel(status, reviewRequired)}</StatusBadge>
    {blocked ? (
      <StatusBadge tone={TONES[blocked]}>
        {blocked === 'blocked' ? 'Blocked' : 'On hold'}
      </StatusBadge>
    ) : null}
    {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
  </>
);

export const TASK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_LABEL[p] }));

export const dueText = (t: { dueOn: string; dueTime: string | null }) =>
  `${fmtDate(t.dueOn)}${t.dueTime ? `, ${t.dueTime.slice(0, 5)} IST` : ''}`;

/** Due label in IST words: "Overdue since …", "Due today, 17:30 IST", "Due 24 Oct 2026". */
export function dueLabel(
  t: { status: TaskStatus; dueOn: string; dueTime: string | null },
  now: Date,
) {
  if (t.status === 'done' || t.status === 'cancelled') return dueText(t);
  if (isOverdue(t, now)) return `Overdue since ${dueText(t)}`;
  const today = istToday(now);
  return t.dueOn === today
    ? `Due today${t.dueTime ? `, ${t.dueTime.slice(0, 5)} IST` : ''}`
    : `Due ${dueText(t)}`;
}

/** The deadline in force, and the original when it moved (brief §10). */
export function Deadline({
  t,
}: {
  t: { dueOn: string; dueTime: string | null; originalDueOn: string; status: TaskStatus };
}) {
  return (
    <>
      {deadlineText(t.dueOn, t.dueTime)}
      {t.originalDueOn !== t.dueOn ? (
        <span className="el-field-hint"> (originally {fmtDate(t.originalDueOn)})</span>
      ) : null}
      {isOverdue(t, new Date()) ? (
        <>
          {' '}
          <StatusBadge tone="danger">Overdue</StatusBadge>
        </>
      ) : null}
    </>
  );
}

/** "Delivered 23 Oct, 4:10 pm · Not yet acknowledged" (delivery and acknowledgement apart). */
export function deliveryText(t: {
  status: TaskStatus;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
}) {
  if (t.status === 'draft') return 'Draft: not assigned yet';
  const delivered = t.deliveredAt ? `Delivered ${istWhen(t.deliveredAt)}` : 'Not delivered in-app';
  const ack = t.acknowledgedAt
    ? `acknowledged ${istWhen(t.acknowledgedAt)}`
    : 'Not yet acknowledged';
  return `${delivered} · ${ack}`;
}

/** The assignee's one obvious next step: a button, or a link to the submit form. */
export function NextActionButton({
  t,
  base,
  closedBy = 'owner',
}: {
  t: {
    id: string;
    title: string;
    version: number;
    status: TaskStatus;
    reviewRequired: boolean;
    acknowledgedAt: Date | null;
    blockedAt: Date | null;
  };
  base: string;
  /** Setting tasks.completion_without_reviewer: 'manager' = the owner cannot mark it done. */
  closedBy?: 'owner' | 'manager';
}) {
  const next = nextAction(
    {
      status: t.status,
      reviewRequired: t.reviewRequired,
      acknowledged: Boolean(t.acknowledgedAt),
      blocked: Boolean(t.blockedAt),
      selfLogged: false,
    },
    closedBy,
  );
  const { tasks, api } = taskPaths(base);
  if (!next)
    return (
      <span className="el-field-hint">
        {t.status === 'in_review'
          ? 'Waiting for review'
          : t.status === 'done' || t.status === 'cancelled'
            ? 'Nothing to do'
            : 'Your manager closes it'}
      </span>
    );
  if (next.action === 'submit')
    return (
      <ButtonLink variant="primary" href={`${tasks}/${t.id}#submit`}>
        {next.label}
        <span className="el-visually-hidden"> — {t.title}</span>
      </ButtonLink>
    );
  return (
    <ActionForm
      compact
      action={`${api}/${t.id}/${ACTION_SLUG[next.action]}`}
      submitLabel={next.label}
      labelSuffix={` — ${t.title}`}
      extra={{ expectedVersion: t.version }}
      successText={`${ACTION_RULES[next.action].label}: saved.`}
    />
  );
}
