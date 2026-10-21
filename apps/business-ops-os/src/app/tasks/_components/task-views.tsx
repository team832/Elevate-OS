import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import { ButtonLink, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { isIsoDate, istToday } from '../../../domain/dates';
import {
  missingReasons,
  needsReason,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type EodItem,
  type TaskStatus,
} from '../../../domain/staff-tasks';
import { formOptions } from '../../../server/options';
import { globalSearch } from '../../../server/search';
import { staffIdForUser } from '../../../server/context';
import { getTask, listTasks, myDay, NO_STAFF_RECORD } from '../../../server/staff-tasks';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { StatCard } from '../../../ui/charts';
import { fmtDate } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref, options, Pager, SearchPanel } from '../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { QuickAdd } from './quick-add';

export type Params = Record<string, string | undefined>;
export const BASE = '/ops/tasks';
const API = '/ops/api/v1/staff-tasks';
const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }));
const TONES = {
  pending: 'neutral',
  in_progress: 'info',
  done: 'success',
  blocked: 'danger',
  on_hold: 'warning',
} as const;

export const TaskBadge = ({ status, overdue }: { status: TaskStatus; overdue?: boolean }) => (
  <>
    <StatusBadge tone={TONES[status]}>{TASK_STATUS_LABELS[status]}</StatusBadge>
    {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
  </>
);

export const dueText = (t: { dueOn: string; dueTime: string | null }) =>
  `${fmtDate(t.dueOn)}${t.dueTime ? `, ${t.dueTime.slice(0, 5)}` : ''}`;

/**
 * Status, progress and reason in one row form (the reason is required for blocked / on hold).
 * Each label and the button carry the task title (hidden), so rows have distinct names.
 */
function QuickUpdate({ t }: { t: EodItem }) {
  return (
    <ActionForm
      compact
      action={`${API}/${t.id}`}
      method="PATCH"
      submitLabel="Save"
      variant="secondary"
      labelSuffix={` for ${t.title}`}
      fields={[
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          required: true,
          options: STATUS_OPTIONS,
          defaultValue: t.status,
        },
        {
          name: 'progressPercent',
          label: '% done',
          type: 'number',
          defaultValue: String(t.progressPercent),
        },
        {
          name: 'reason',
          label: needsReason(t.status) ? 'Reason' : 'Reason (if not done today)',
          defaultValue: t.reason ?? '',
        },
      ]}
    />
  );
}

/** A day's tasks; `edit` adds the status/progress/reason form, `href` opens a task. */
export function DayTable({
  rows,
  href,
  edit,
  empty = 'Nothing here.',
}: {
  rows: EodItem[];
  href?: (t: EodItem) => string;
  edit?: boolean;
  empty?: string;
}) {
  return (
    <RecordTable
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={href}
      empty={empty}
      columns={[
        { key: 'title', header: 'Task' },
        { key: 'priority', header: 'Priority', render: (t) => TASK_LABEL[t.priority] },
        { key: 'due', header: 'Due', render: dueText },
        {
          key: 'status',
          header: 'Status',
          render: (t) => <TaskBadge status={t.status} overdue={t.overdue} />,
        },
        edit
          ? { key: 'update', header: 'Update', render: (t) => <QuickUpdate t={t} /> }
          : { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '' },
        ...(edit
          ? []
          : [
              {
                key: 'progress',
                header: '% done',
                numeric: true,
                render: (t: EodItem) => `${t.progressPercent}%`,
              },
            ]),
      ]}
    />
  );
}

const TASK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_LABEL[p] }));
const RECURRENCE_OPTIONS = TASK_RECURRENCES.map((r) => ({
  value: r,
  label: r === 'none' ? 'Does not repeat' : `Repeats ${r}`,
}));

/** Lead and student picks from the existing Admissions search (`rel` query). */
async function relatedFields(
  db: Parameters<typeof globalSearch>[0],
  user: AuthenticatedUser,
  rel: string | undefined,
): Promise<FieldSpec[]> {
  if (!rel) return [];
  const { groups } = await globalSearch(db, user, rel);
  const pick = (key: string) =>
    (groups.find((g) => g.key === key)?.hits ?? []).map((h) => ({
      value: h.id,
      label: `${h.name}${h.code ? ` (${h.code})` : ''}${h.isSample ? ' — sample' : ''}`,
    }));
  const leads = pick('leads');
  const students = pick('students');
  return [
    ...(leads.length
      ? [{ name: 'leadId', label: 'Related lead', type: 'select' as const, options: leads }]
      : []),
    ...(students.length
      ? [
          {
            name: 'admissionId',
            label: 'Related student',
            type: 'select' as const,
            options: students,
          },
        ]
      : []),
  ];
}

/** Open work, grouped by where it stands; carried-forward tasks keep their earlier due date. */
const OPEN_GROUPS = ['in_progress', 'pending', 'blocked', 'on_hold'] as const;

export async function MyDay({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const write = can(user, 'ops:tasks:write');
  const r = await load(async (db) => {
    const [day, staff, related] = await Promise.all([
      myDay(db, user, today),
      write && sp.new ? formOptions(db).then((o) => o.staff) : [],
      write && sp.new ? relatedFields(db, user, sp.rel?.trim() || undefined) : [],
    ]);
    return { day, staff, related };
  });
  if (!r.ok) return r.view;
  const { day, staff, related } = r.data;
  if (!day) return <EmptyState title="Your tasks cannot be shown" description={NO_STAFF_RECORD} />;
  const c = day.counts;
  const open = (t: EodItem) => listHref(BASE, sp, { open: t.id });
  const close = listHref(BASE, sp, { new: undefined, rel: undefined });
  const todo = [...day.carried, ...day.open];
  const missing = missingReasons(day).length;
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Today in numbers">
        <li>
          <StatCard label="Done today" value={c.done} />
        </li>
        <li>
          <StatCard label="Still open today" value={c.open} />
        </li>
        <li>
          <StatCard label="Carried forward" value={c.carried} note="Due on an earlier day" />
        </li>
        <li>
          <StatCard label="Overdue" value={c.overdue} />
        </li>
      </ul>
      {write ? <QuickAdd action={API} version={`${c.open}-${c.carried}-${c.done}`} /> : null}
      {todo.length ? (
        OPEN_GROUPS.map((s) => {
          const rows = todo.filter((t) => t.status === s);
          return rows.length ? (
            <Segment key={s} title={`${TASK_STATUS_LABELS[s]} (${rows.length})`} flush>
              <DayTable rows={rows} href={open} edit={write} />
            </Segment>
          ) : null;
        })
      ) : (
        <EmptyState
          title={c.done ? 'Nothing left open today' : 'No tasks for today yet'}
          description="Add work in the box above the moment it comes in."
        />
      )}
      <Segment title={`Done today (${c.done})`} flush>
        <DayTable rows={day.done} href={open} empty="Nothing completed yet today." />
      </Segment>
      <Segment
        title="End of day"
        description="Give a reason for anything not done, then send the report to your manager."
        actions={
          <ButtonLink variant="secondary" href={listHref(BASE, {}, { tab: 'eod' })}>
            Write the end-of-day report
          </ButtonLink>
        }
      >
        <p className="el-field-hint">
          {missing
            ? `${missing} open task${missing === 1 ? ' needs' : 's need'} a reason before you can send it.`
            : `${c.done} done today${todo.length ? '; every open task has a reason' : ''}.`}
        </p>
      </Segment>
      {write && sp.new ? (
        <FormModal id="log-task" title="Log a task" meta="Times are IST." closeHref={close}>
          <SearchPanel
            action={BASE}
            hidden={{ new: '1' }}
            search={{ name: 'rel', label: 'Link to a lead or student (optional)', value: sp.rel }}
            submitLabel="Find"
          />
          {sp.rel && related.length === 0 ? (
            <p className="el-field-hint">
              No lead or student you can see matches “{sp.rel}”. Log the task without a link, or
              search again.
            </p>
          ) : null}
          <ActionForm
            action={API}
            submitLabel="Add task"
            redirectTo={BASE}
            secondary={<a href={close}>Cancel</a>}
            fields={[
              { name: 'title', label: 'Task', required: true, section: 'Task' },
              {
                name: 'priority',
                label: 'Priority',
                type: 'select',
                required: true,
                options: PRIORITY_OPTIONS,
                defaultValue: 'medium',
                section: 'Task',
              },
              {
                name: 'dueTime',
                label: 'Due time today (IST)',
                hint: '24-hour, e.g. 17:30. Leave empty for end of day.',
                section: 'Task',
              },
              ...related.map((f) => ({ ...f, section: 'Task' })),
              {
                name: 'dueOn',
                label: 'Due on another day',
                type: 'date',
                section: 'More (optional)',
              },
              {
                name: 'assignedByStaffId',
                label: 'Given by',
                type: 'select',
                options: staff,
                section: 'More (optional)',
              },
              {
                name: 'recurrence',
                label: 'Repeats',
                type: 'select',
                required: true,
                options: RECURRENCE_OPTIONS,
                defaultValue: 'none',
                section: 'More (optional)',
              },
              { name: 'details', label: 'Details', type: 'textarea', section: 'More (optional)' },
            ]}
          />
        </FormModal>
      ) : null}
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} /> : null}
    </div>
  );
}

export async function AllTasks({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const everyone = scopeFor(user, 'ops:tasks:read') === 'all';
  const filters = {
    q: sp.q?.trim() || undefined,
    status: TASK_STATUSES.find((s) => s === sp.status),
    priority: TASK_PRIORITIES.find((p) => p === sp.priority),
    staffId: everyone ? sp.staffId || undefined : undefined,
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
    page: Math.max(1, Number(sp.page) || 1),
  };
  const r = await load(async (db) => {
    const [list, staff] = await Promise.all([
      listTasks(db, user, filters),
      everyone ? formOptions(db).then((o) => o.staff) : [],
    ]);
    return { list, staff };
  });
  if (!r.ok) return r.view;
  const { list, staff } = r.data;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={{ tab: 'all' }}
        search={{ name: 'q', label: 'Task title', value: sp.q }}
        filters={[
          ...(everyone
            ? [
                {
                  name: 'staffId',
                  label: 'Staff member',
                  type: 'select' as const,
                  options: staff,
                  value: filters.staffId,
                  anyLabel: 'Everyone',
                },
              ]
            : []),
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: STATUS_OPTIONS,
            value: filters.status,
          },
          {
            name: 'priority',
            label: 'Priority',
            type: 'select',
            options: options(TASK_PRIORITIES),
            value: filters.priority,
          },
          { name: 'from', label: 'Due from', type: 'date', value: filters.from },
          { name: 'to', label: 'Due to', type: 'date', value: filters.to },
        ]}
      />
      <RecordTable
        caption={`${list.total} task${list.total === 1 ? '' : 's'}`}
        rows={list.rows}
        rowKey={(t) => t.id}
        rowHref={(t) => listHref(BASE, sp, { open: t.id })}
        empty={
          <EmptyState
            title="No tasks match"
            description="Clear a filter, or log a task on My day."
          />
        }
        columns={[
          { key: 'title', header: 'Task' },
          ...(everyone ? [{ key: 'staffName' as const, header: 'Staff member' }] : []),
          { key: 'priority', header: 'Priority', render: (t) => TASK_LABEL[t.priority] },
          { key: 'due', header: 'Due', render: dueText },
          { key: 'status', header: 'Status', render: (t) => <TaskBadge status={t.status} /> },
          {
            key: 'progress',
            header: '% done',
            numeric: true,
            render: (t) => `${t.progressPercent}%`,
          },
          { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '' },
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} /> : null}
    </div>
  );
}

async function TaskModal({ user, id, sp }: { user: AuthenticatedUser; id: string; sp: Params }) {
  const r = await load(async (db) =>
    Promise.all([getTask(db, user, id), staffIdForUser(db, user.id)]),
  );
  if (!r.ok) return r.view;
  const [t, self] = r.data;
  const related = t.leadId
    ? { label: 'Related lead', href: `/ops/leads/${t.leadId}` }
    : t.admissionId
      ? { label: 'Related student', href: `/ops/students/${t.admissionId}` }
      : null;
  const editable =
    scopeFor(user, 'ops:tasks:write') === 'all' ||
    (self === t.staffId && can(user, 'ops:tasks:write'));
  return (
    <RecordModal
      id="task-modal"
      title={t.title}
      meta={<TaskBadge status={t.status} />}
      closeHref={listHref(BASE, sp, { open: undefined })}
      returnId={t.id}
      tabs={[
        {
          key: 'details',
          label: 'Details',
          content: (
            <Segment title="Task" level={3} flush>
              <DetailTable
                rows={[
                  { label: 'Staff member', value: t.staffName ?? 'Not recorded' },
                  { label: 'Due', value: dueText(t) },
                  { label: 'Priority', value: TASK_LABEL[t.priority] },
                  { label: '% done', value: `${t.progressPercent}%` },
                  { label: 'Reason', value: t.reason ?? 'None given' },
                  { label: 'Given by', value: t.assignedByName ?? 'Not recorded' },
                  {
                    label: 'Repeats',
                    value: RECURRENCE_OPTIONS.find((o) => o.value === t.recurrence)!.label,
                  },
                  { label: 'Details', value: t.details ?? 'None' },
                  related && {
                    label: related.label,
                    value: <a href={related.href}>Open record</a>,
                  },
                ]}
              />
            </Segment>
          ),
        },
        ...(editable
          ? [
              {
                key: 'edit',
                label: 'Edit',
                content: (
                  <ActionForm
                    action={`${API}/${t.id}`}
                    method="PATCH"
                    submitLabel="Save changes"
                    fields={[
                      { name: 'title', label: 'Task', required: true, defaultValue: t.title },
                      {
                        name: 'status',
                        label: 'Status',
                        type: 'select',
                        required: true,
                        options: STATUS_OPTIONS,
                        defaultValue: t.status,
                      },
                      {
                        name: 'progressPercent',
                        label: '% done',
                        type: 'number',
                        defaultValue: String(t.progressPercent),
                      },
                      {
                        name: 'reason',
                        label: 'Reason',
                        hint: 'Required when blocked or on hold.',
                        defaultValue: t.reason ?? '',
                      },
                      {
                        name: 'priority',
                        label: 'Priority',
                        type: 'select',
                        required: true,
                        options: PRIORITY_OPTIONS,
                        defaultValue: t.priority,
                      },
                      {
                        name: 'dueOn',
                        label: 'Due on',
                        type: 'date',
                        required: true,
                        defaultValue: t.dueOn,
                      },
                      {
                        name: 'dueTime',
                        label: 'Due time (IST)',
                        hint: '24-hour, e.g. 17:30.',
                        defaultValue: t.dueTime?.slice(0, 5) ?? '',
                      },
                      {
                        name: 'recurrence',
                        label: 'Repeats',
                        type: 'select',
                        required: true,
                        options: RECURRENCE_OPTIONS,
                        defaultValue: t.recurrence,
                      },
                      {
                        name: 'details',
                        label: 'Details',
                        type: 'textarea',
                        defaultValue: t.details ?? '',
                      },
                    ]}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
