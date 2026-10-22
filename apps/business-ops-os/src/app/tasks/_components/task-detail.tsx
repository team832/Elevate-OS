/**
 * Task detail sections (brief 2 §6, §12B, §16): facts, actions the caller may take (the server
 * checks again), dependencies, work updates, the end-to-end report and the event history.
 */
import { Alert, ButtonLink, StatusBadge } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import { ACTION_RULES, type TaskAction } from '../../../domain/task-lifecycle';
import { EVENT_LABELS, eventDetail, fmtDuration, updateDetail } from '../../../domain/task-report';
import { TASK_STATUS_LABELS } from '../../../domain/staff-tasks';
import { minutesOf } from '../../../domain/task-lifecycle';
import { ACTION_SLUG } from '../../../server/staff-tasks-schemas';
import type { TaskDetail } from '../../../server/task-detail';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { DetailTable, Segment, Timeline } from '../../../ui/sections';
import { API, dueText, PRIORITY_OPTIONS, TASK_LABEL } from './task-views';

type Option = { value: string; label: string };
const PRIMARY: readonly TaskAction[] = [
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
export function TaskFacts({ d, level = 2 }: { d: TaskDetail; level?: 2 | 3 }) {
  const dueChanges = d.events.filter((e) => e.kind === 'due_changed').length;
  return (
    <Segment title="Requirement and people" level={level} flush>
      <DetailTable
        rows={[
          { label: 'Details', value: d.details ?? 'None recorded' },
          { label: 'Done when', value: d.acceptanceCriteria ?? 'No acceptance criteria recorded' },
          { label: 'Accountable owner', value: d.staffName ?? 'Not recorded' },
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
            label: 'Due',
            value: `${dueText(d)}${dueChanges ? ` (changed ${dueChanges}×, see history)` : ''}`,
          },
          {
            label: 'Acknowledged',
            value: d.acknowledgedAt ? fmtDateTime(d.acknowledgedAt) : 'Not yet',
          },
          { label: '% done', value: `${d.progressPercent}% (self-reported)` },
          d.reason && { label: 'Reason', value: d.reason },
          d.completedAt && { label: 'Completed', value: fmtDateTime(d.completedAt) },
          d.linkedRef && { label: 'Linked record', value: d.linkedRef },
          d.leadId && {
            label: 'Related lead',
            value: <a href={`/ops/leads/${d.leadId}`}>Open lead</a>,
          },
          d.admissionId && {
            label: 'Related student',
            value: <a href={`/ops/students/${d.admissionId}`}>Open student</a>,
          },
        ]}
      />
    </Segment>
  );
}

function ActionButton({ d, action }: { d: TaskDetail; action: TaskAction }) {
  const rule = ACTION_RULES[action];
  const form = (
    <ActionForm
      compact
      action={`${API}/${d.id}/${ACTION_SLUG[action]}`}
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
export function TaskActions({ d, staff }: { d: TaskDetail; staff: Option[] }) {
  const targets = staff.filter(
    (s) =>
      s.value !== d.staffId &&
      s.value !== d.reviewerStaffId &&
      (!d.assignable || d.assignable.includes(s.value)),
  );
  if (!d.allowed.length && !d.canEdit)
    return (
      <p className="el-field-hint">
        You can read this task; only its owner, manager or reviewer acts on it.
      </p>
    );
  return (
    <Segment title="What you can do">
      <div className="el-stack">
        <div className="el-card-actions">
          {d.allowed
            .filter((a) => !ACTION_RULES[a].reason)
            .map((a) => (
              <ActionButton key={a} d={d} action={a} />
            ))}
        </div>
        {d.allowed
          .filter((a) => ACTION_RULES[a].reason)
          .map((a) => (
            <ActionButton key={a} d={d} action={a} />
          ))}
        {d.canReassign && targets.length ? (
          <details className="el-explain">
            <summary>Hand over to someone else…</summary>
            <ActionForm
              action={`${API}/${d.id}/reassign`}
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
            <summary>Edit details, due date or priority…</summary>
            <ActionForm
              action={`${API}/${d.id}`}
              method="PATCH"
              submitLabel="Save changes"
              extra={{ expectedVersion: d.version }}
              fields={[
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
                { name: 'changeReason', label: 'Why the date or priority changed' },
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
              ]}
            />
          </details>
        ) : null}
      </div>
    </Segment>
  );
}

const statusOf = (s: keyof typeof TASK_STATUS_LABELS) => TASK_STATUS_LABELS[s];

export function TaskDependencies({ d, candidates }: { d: TaskDetail; candidates: Option[] }) {
  const linked = new Set<string>(d.waitsOn.map((t) => t.id));
  const options = candidates.filter((c) => c.value !== d.id && !linked.has(c.value));
  const list = (items: TaskDetail['waitsOn']) =>
    items.length ? (
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            {t.visible ? <a href={`/ops/tasks/${t.id}`}>{t.title}</a> : t.title} —{' '}
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
          action={`${API}/${d.id}/dependencies`}
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

const UPDATE_FIELDS: FieldSpec[] = [
  {
    name: 'workPerformed',
    label: 'Work performed',
    type: 'textarea',
    required: true,
    section: 'Work',
  },
  { name: 'result', label: 'Result', section: 'Work' },
  { name: 'remainingWork', label: 'Remaining', section: 'Work' },
  { name: 'blocker', label: 'Blocker', section: 'Work' },
  { name: 'nextStep', label: 'Next step', section: 'Work' },
  { name: 'evidence', label: 'Evidence', hint: 'A link or where to find it.', section: 'Work' },
  {
    name: 'occurredOn',
    label: 'Work date',
    type: 'date',
    hint: 'IST. A late entry keeps this date and the time you record it.',
    section: 'Time (optional)',
  },
  { name: 'durationMinutes', label: 'Minutes spent', type: 'number', section: 'Time (optional)' },
  { name: 'startedAt', label: 'Started (IST)', type: 'datetime', section: 'Time (optional)' },
  { name: 'endedAt', label: 'Stopped (IST)', type: 'datetime', section: 'Time (optional)' },
];

const local = (at: Date | null) =>
  at ? new Date(+at + 330 * 60000).toISOString().slice(0, 16) : '';

export function WorkUpdates({ d }: { d: TaskDetail }) {
  const items = [...d.updates].reverse().map((u) => {
    const minutes = minutesOf(u);
    const late = istToday(u.recordedAt) > u.occurredOn;
    return {
      key: u.id,
      when: `Work date ${fmtDate(u.occurredOn)} · recorded ${fmtDateTime(u.recordedAt)}${late ? ' (later)' : ''}`,
      title: `${u.authorName}${minutes !== null ? ` · ${fmtDuration(minutes)}` : ''}${u.corrected ? ' · replaced by a correction' : ''}`,
      detail: (
        <>
          {updateDetail(u)}
          {u.warnings.map((w) => (
            <StatusBadge key={w} tone="warning">
              {w}
            </StatusBadge>
          ))}
          {u.authorStaffId === d.selfStaffId && !u.corrected ? (
            <details className="el-explain">
              <summary>Correct this entry…</summary>
              <ActionForm
                action={`${API}/${d.id}/updates`}
                submitLabel="Save correction"
                extra={{ correctsUpdateId: u.id }}
                fields={[
                  {
                    name: 'correctionReason',
                    label: 'What was wrong',
                    required: true,
                    section: 'Correction',
                  },
                  ...UPDATE_FIELDS.map((f) => ({
                    ...f,
                    defaultValue:
                      f.name === 'startedAt' || f.name === 'endedAt'
                        ? local(u[f.name])
                        : String(u[f.name as keyof typeof u] ?? ''),
                  })),
                ]}
              />
            </details>
          ) : null}
        </>
      ),
    };
  });
  return (
    <Segment
      title={`Work updates (${d.updates.length})`}
      description="Newest first. Entries are never edited: a correction is a new entry with a reason."
    >
      <div className="el-stack">
        {d.canLogWork ? (
          <details className="el-explain" open={!d.updates.length}>
            <summary>Log work</summary>
            <ActionForm
              action={`${API}/${d.id}/updates`}
              submitLabel="Log work"
              successText="Work logged."
              fields={UPDATE_FIELDS}
            />
          </details>
        ) : null}
        {items.length ? (
          <Timeline label="Work updates" items={items} />
        ) : (
          <p className="el-field-hint">No work logged yet.</p>
        )}
      </div>
    </Segment>
  );
}

export function TaskReport({ d }: { d: TaskDetail }) {
  const href = (f: string) => `${API}/${d.id}/report?format=${f}`;
  return (
    <Segment
      title="End-to-end report"
      actions={
        <>
          <ButtonLink href={href('pdf')}>Download PDF</ButtonLink>{' '}
          <ButtonLink href={href('csv')}>Download CSV</ButtonLink>
        </>
      }
    >
      <DetailTable
        rows={[
          {
            label: 'Recorded work time',
            value: `${fmtDuration(d.time.recordedMinutes)} (sum of work updates, self-reported)`,
          },
          {
            label: 'Elapsed time',
            value: `${fmtDuration(d.time.elapsedMinutes)} since received (not effort)`,
          },
          {
            label: 'Waiting time',
            value: `${fmtDuration(d.time.waitingMinutes)} blocked, on hold or in review`,
          },
          ...d.time.waits.map((w, i) => ({
            label: i ? '' : 'Waiting intervals',
            value: `${statusOf(w.status)}: ${fmtDateTime(w.from)} – ${fmtDateTime(w.to)}${w.reason ? ` · ${w.reason}` : ''}`,
          })),
        ]}
      />
    </Segment>
  );
}

export function TaskHistory({ d }: { d: TaskDetail }) {
  return (
    <Segment title="History" description="Every change, newest first, with who made it.">
      <Timeline
        label="Task history"
        items={[...d.events].reverse().map((e) => ({
          key: e.id,
          when: fmtDateTime(e.occurredAt),
          title: `${EVENT_LABELS[e.kind]} · ${e.actorName}`,
          detail: eventDetail(e) || undefined,
        }))}
      />
    </Segment>
  );
}

export function WaitingAlert({ d }: { d: TaskDetail }) {
  if (!d.waitingOn.length && d.acknowledgedAt) return null;
  return (
    <>
      {d.waitingOn.length ? (
        <Alert tone="warning" title={`Waiting on ${d.waitingOn.map((t) => `“${t}”`).join(', ')}`}>
          Finishing those tasks does not complete this one.
        </Alert>
      ) : null}
      {!d.acknowledgedAt ? (
        <Alert title={`Assigned to ${d.staffName ?? 'the owner'}, not yet acknowledged`}>
          Acknowledging confirms the task was received. It does not change its status.
        </Alert>
      ) : null}
    </>
  );
}
