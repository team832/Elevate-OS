/**
 * Task detail sections (brief 2 §6, §12B, §16): facts, actions the caller may take (the server
 * checks again) and dependencies (work: task-work.tsx; report and history: task-history.tsx).
 */
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { ACTION_RULES, type TaskAction } from '../../../domain/task-lifecycle';
import { istWhen, TASK_STATUS_LABELS } from '../../../domain/staff-tasks';
import { ACTION_SLUG } from '../../../server/staff-tasks-schemas';
import type { TaskDetail } from '../../../server/task-detail';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { DetailTable, Segment } from '../../../ui/sections';
import { NoticeStates } from '../../../ui/task-notices';
import { deliveryText, dueText, PRIORITY_OPTIONS, TASK_LABEL, taskPaths } from './task-common';

type Option = { value: string; label: string };
/** Submit, review decisions and comments have their own forms (task-work.tsx). */
export const OWN_FORMS: readonly TaskAction[] = ['submit', 'approve', 'request_changes', 'comment'];
const PRIMARY: readonly TaskAction[] = [
  'publish',
  'acknowledge',
  'start',
  'submit',
  'approve',
  'complete',
  'resume',
];

export function AckBadge({ at }: { at: Date | null }) {
  return at ? null : <StatusBadge tone="warning">Not acknowledged</StatusBadge>;
}

/** Requirement, people and dates (also the summary in the list's pop-up). */
/** Related records link only where this workspace shows them (leads: Ops and Marketing; students: Ops). */
export function TaskFacts({ d, base, level = 2 }: { d: TaskDetail; base: string; level?: 2 | 3 }) {
  const dueChanges = d.events.filter((e) => e.kind === 'due_changed').length;
  return (
    <Segment title="Requirement and people" level={level} flush>
      <DetailTable
        rows={[
          { label: 'Details', value: d.details ?? 'None recorded' },
          d.category && { label: 'Category', value: d.category },
          { label: 'Expected deliverable', value: d.expectedDeliverable ?? 'Not specified' },
          { label: 'Done when', value: d.acceptanceCriteria ?? 'No acceptance criteria recorded' },
          { label: 'Accountable owner', value: d.staffName ?? 'Not recorded' },
          {
            label: 'Notification',
            value:
              d.status === 'draft' ? (
                deliveryText(d)
              ) : (
                <NoticeStates f={{ ...d, readAt: d.noticeReadAt }} />
              ),
          },
          d.parent && {
            label: 'Part of',
            value: <a href={`${taskPaths(base).tasks}/${d.parent.id}`}>{d.parent.title}</a>,
          },
          d.group && {
            label: 'Assigned to several people',
            value: `${d.group.done} of ${d.group.total} approved (each person's task is tracked on its own)`,
          },
          d.relatedLabel && { label: `Related ${d.relatedKind}`, value: d.relatedLabel },
          d.collaborators.length > 0 && {
            label: 'Collaborators',
            value: d.collaborators.map((c) => c.name).join(', '),
          },
          { label: 'Backup', value: d.backupName ?? 'None' },
          {
            label: 'Review',
            value: d.reviewRequired
              ? `${d.reviewerName ?? 'An operations manager'} closes it`
              : 'No review step: the owner marks it done',
          },
          {
            label: 'Given by',
            value: d.selfLogged ? 'Self-logged' : (d.assignedByName ?? 'Not recorded'),
          },
          { label: 'Requested by', value: d.requesterName ?? d.requesterNote ?? 'Not recorded' },
          { label: 'Source', value: humanise(d.source) },
          { label: 'Department', value: d.departmentName ?? 'Not recorded' },
          { label: 'Priority', value: TASK_LABEL[d.priority] },
          { label: 'Received', value: fmtDateTime(d.receivedAt) },
          d.plannedStartOn && { label: 'Planned start', value: fmtDate(d.plannedStartOn) },
          {
            label: 'Deadline',
            value: `${dueText(d)}${dueChanges ? ` (changed ${dueChanges}×, see history)` : ''}`,
          },
          dueChanges > 0 && {
            label: 'Original deadline',
            value: dueText({ dueOn: d.originalDueOn, dueTime: d.originalDueTime }),
          },
          d.blockedAt && {
            label: d.blockedKind === 'on_hold' ? 'On hold' : 'Blocked',
            value: `${d.blockedReason} (since ${istWhen(d.blockedAt)})`,
          },
          d.firstSubmittedAt && {
            label: 'First submitted',
            value: `${istWhen(d.firstSubmittedAt)}${d.onTime === null ? '' : d.onTime ? ' · on time' : ' · late'}`,
          },
          d.lastSubmittedAt &&
            +d.lastSubmittedAt !== +(d.firstSubmittedAt ?? 0) && {
              label: 'Latest submission',
              value: istWhen(d.lastSubmittedAt),
            },
          d.approvedAt && { label: 'Approved', value: istWhen(d.approvedAt) },
          { label: '% done', value: `${d.progressPercent}% (self-reported)` },
          d.reason && { label: 'Reason', value: d.reason },
          d.completedAt && { label: 'Completed', value: fmtDateTime(d.completedAt) },
          d.linkedRef && { label: 'Linked record', value: d.linkedRef },
          d.leadId && {
            label: 'Related lead',
            value:
              base === '/academic' ? (
                'Recorded in Business Operations'
              ) : (
                <a href={`${base}/leads/${d.leadId}`}>Open lead</a>
              ),
          },
          d.admissionId && {
            label: 'Related student',
            value:
              base === '/ops' ? (
                <a href={`${base}/students/${d.admissionId}`}>Open student</a>
              ) : (
                'Recorded in Business Operations'
              ),
          },
        ]}
      />
    </Segment>
  );
}

function ActionButton({ d, action, api }: { d: TaskDetail; action: TaskAction; api: string }) {
  const rule = ACTION_RULES[action];
  const form = (
    <ActionForm
      compact
      action={`${api}/${d.id}/${ACTION_SLUG[action]}`}
      submitLabel={rule.label}
      variant={action === 'cancel' ? 'danger' : PRIMARY.includes(action) ? 'primary' : 'secondary'}
      extra={{ expectedVersion: d.version }}
      fields={rule.reason ? [{ name: 'reason', label: 'Reason', required: true }] : []}
      successText={`${rule.label}: saved.`}
    />
  );
  return rule.reason ? (
    <details className="el-explain">
      <summary>{rule.label}…</summary>
      {form}
    </details>
  ) : (
    form
  );
}

/** Only the actions the caller may take now; the reassign and edit forms when allowed. */
export function TaskActions({ d, staff, base }: { d: TaskDetail; staff: Option[]; base: string }) {
  const { api } = taskPaths(base);
  const targets = staff.filter(
    (s) =>
      s.value !== d.staffId &&
      s.value !== d.reviewerStaffId &&
      (!d.assignable || d.assignable.includes(s.value)),
  );
  if (!d.allowed.some((a) => !OWN_FORMS.includes(a)) && !d.canEdit)
    return (
      <p className="el-field-hint">
        {d.status === 'in_review'
          ? 'Submitted: waiting for the reviewer.'
          : 'You can read this task; only its owner, manager or reviewer acts on it.'}
      </p>
    );
  return (
    <Segment title="What you can do">
      <div className="el-stack">
        <div className="el-card-actions">
          {d.allowed
            .filter((a) => !ACTION_RULES[a].reason && !OWN_FORMS.includes(a))
            .map((a) => (
              <ActionButton key={a} d={d} action={a} api={api} />
            ))}
        </div>
        {d.allowed
          .filter((a) => ACTION_RULES[a].reason && !OWN_FORMS.includes(a))
          .map((a) => (
            <ActionButton key={a} d={d} action={a} api={api} />
          ))}
        {d.canReassign && targets.length ? (
          <details className="el-explain">
            <summary>Hand over to someone else…</summary>
            <ActionForm
              action={`${api}/${d.id}/reassign`}
              submitLabel="Hand over task"
              extra={{ expectedVersion: d.version }}
              fields={[
                {
                  name: 'toStaffId',
                  label: 'New owner',
                  type: 'select',
                  required: true,
                  options: targets,
                },
                { name: 'reason', label: 'Reason' },
              ]}
            />
          </details>
        ) : null}
        {d.canEdit ? (
          <details className="el-explain">
            <summary>
              {d.canEditBrief
                ? 'Edit details, due date or priority…'
                : 'Update priority or progress…'}
            </summary>
            <ActionForm
              action={`${api}/${d.id}`}
              method="PATCH"
              submitLabel="Save changes"
              extra={{ expectedVersion: d.version }}
              fields={(
                [
                  { name: 'title', label: 'Task', required: true, defaultValue: d.title },
                  {
                    name: 'priority',
                    label: 'Priority',
                    type: 'select',
                    required: true,
                    options: PRIORITY_OPTIONS,
                    defaultValue: d.priority,
                  },
                  {
                    name: 'dueOn',
                    label: 'Due on',
                    type: 'date',
                    required: true,
                    defaultValue: d.dueOn,
                  },
                  {
                    name: 'dueTime',
                    label: 'Due time (IST)',
                    hint: '24-hour, e.g. 17:30.',
                    defaultValue: d.dueTime?.slice(0, 5) ?? '',
                  },
                  {
                    name: 'changeReason',
                    label: 'Why the deadline or priority changed',
                    hint: 'Required when the deadline changes. The original deadline is kept.',
                  },
                  {
                    name: 'expectedDeliverable',
                    label: 'Expected deliverable',
                    defaultValue: d.expectedDeliverable ?? '',
                  },
                  {
                    name: 'progressPercent',
                    label: '% done (self-reported)',
                    type: 'number',
                    defaultValue: String(d.progressPercent),
                  },
                  {
                    name: 'acceptanceCriteria',
                    label: 'Done when',
                    type: 'textarea',
                    defaultValue: d.acceptanceCriteria ?? '',
                  },
                  {
                    name: 'details',
                    label: 'Details',
                    type: 'textarea',
                    defaultValue: d.details ?? '',
                  },
                ] satisfies FieldSpec[]
              ).filter((f) => d.canEditBrief || !BRIEF_FIELD_NAMES.has(f.name))}
            />
          </details>
        ) : null}
      </div>
    </Segment>
  );
}

/** I1: on assigned work these are the assigner's (the assignee asks for clarification). */
const BRIEF_FIELD_NAMES = new Set([
  'title',
  'dueOn',
  'dueTime',
  'changeReason',
  'expectedDeliverable',
  'acceptanceCriteria',
  'details',
]);

const statusOf = (s: keyof typeof TASK_STATUS_LABELS) => TASK_STATUS_LABELS[s];

export function TaskDependencies({
  d,
  candidates,
  base,
}: {
  d: TaskDetail;
  candidates: Option[];
  base: string;
}) {
  const { tasks, api } = taskPaths(base);
  const linked = new Set<string>(d.waitsOn.map((t) => t.id));
  const options = candidates.filter((c) => c.value !== d.id && !linked.has(c.value));
  const list = (items: TaskDetail['waitsOn']) =>
    items.length ? (
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            {t.visible ? <a href={`${tasks}/${t.id}`}>{t.title}</a> : t.title} —{' '}
            {statusOf(t.status)}
          </li>
        ))}
      </ul>
    ) : (
      'Nothing'
    );
  return (
    <Segment title="Dependencies" flush={!d.canEdit}>
      <DetailTable
        rows={[
          { label: 'Waits on', value: list(d.waitsOn) },
          { label: 'Holds up', value: list(d.blocks) },
        ]}
      />
      {d.canEdit && options.length ? (
        <ActionForm
          compact
          action={`${api}/${d.id}/dependencies`}
          submitLabel="Add dependency"
          variant="secondary"
          extra={{ expectedVersion: d.version }}
          fields={[
            {
              name: 'dependsOnTaskId',
              label: 'This task waits on',
              type: 'select',
              required: true,
              options,
            },
          ]}
        />
      ) : null}
    </Segment>
  );
}

export function WaitingAlert({ d }: { d: TaskDetail }) {
  if (d.status === 'draft')
    return (
      <Alert title="Draft: not assigned yet">
        {d.staffName ?? 'The assignee'} cannot see this task until you assign it.
      </Alert>
    );
  if (!d.waitingOn.length && d.acknowledgedAt) return null;
  return (
    <>
      {d.waitingOn.length ? (
        <Alert tone="warning" title={`Waiting on ${d.waitingOn.map((t) => `“${t}”`).join(', ')}`}>
          Finishing those tasks does not complete this one.
        </Alert>
      ) : null}
      {!d.acknowledgedAt && d.status !== 'done' && d.status !== 'cancelled' ? (
        <Alert title={`Assigned to ${d.staffName ?? 'the owner'}, not yet acknowledged`}>
          Acknowledging confirms the task was received. It does not change its status.
        </Alert>
      ) : null}
    </>
  );
}
