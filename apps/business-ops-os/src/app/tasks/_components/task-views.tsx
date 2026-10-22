import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import { ButtonLink, EmptyState, StatusBadge, Tabs } from '@elevate/shared-ui';
import { isIsoDate, istToday } from '../../../domain/dates';
import {
  isOverdue,
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
import { listTasks, myDay, NO_STAFF_RECORD } from '../../../server/staff-tasks';
import { TASK_DUE_FILTERS } from '../../../server/staff-tasks-schemas';
import { rowStatusOptions, taskDetail, type RowOptions } from '../../../server/task-detail';
import { coversOwner, taskAccess } from '../../../server/task-store';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { StatCard } from '../../../ui/charts';
import { fmtDate } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { QuickAdd } from './quick-add';
import { AckBadge, TaskFacts } from './task-detail';

export type Params = Record<string, string | undefined>;
export const BASE = '/ops/tasks';
export const API = '/ops/api/v1/staff-tasks';
const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }));
const TONES = {
  pending: 'neutral',
  in_progress: 'info',
  done: 'success',
  blocked: 'danger',
  on_hold: 'warning',
  in_review: 'info',
  cancelled: 'neutral',
} as const;

export const TaskBadge = ({ status, overdue }: { status: TaskStatus; overdue?: boolean }) => (
  <>
    <StatusBadge tone={TONES[status]}>{TASK_STATUS_LABELS[status]}</StatusBadge>
    {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
  </>
);

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

/**
 * Status, progress and reason in one row form (the reason is required for blocked / on hold).
 * Each label and the button carry the task title (hidden), so rows have distinct names.
 */
function QuickUpdate({ t, opts }: { t: EodItem; opts: RowOptions }) {
  return (
    <ActionForm
      compact
      action={`${API}/${t.id}`}
      method="PATCH"
      submitLabel="Save"
      variant="secondary"
      labelSuffix={` for ${t.title}`}
      extra={{ expectedVersion: opts.version }}
      fields={[
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          required: true,
          options: opts.statuses.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
          defaultValue: t.status,
        },
        {
          name: 'progressPercent',
          label: '% done (self-reported)',
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

/** A day's tasks; `edit` (version and allowed statuses per task) adds the row form, `href` opens a task. */
export function DayTable({
  rows,
  href,
  edit,
  empty = 'Nothing here.',
}: {
  rows: EodItem[];
  href?: (t: EodItem) => string;
  edit?: ReadonlyMap<string, RowOptions>;
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
          ? {
              key: 'update',
              header: 'Update',
              render: (t) => {
                const opts = edit.get(t.id);
                return opts ? <QuickUpdate t={t} opts={opts} /> : (t.reason ?? '');
              },
            }
          : { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '' },
        ...(edit
          ? []
          : [
              {
                key: 'progress',
                header: '% done (self-reported)',
                numeric: true,
                render: (t: EodItem) => `${t.progressPercent}%`,
              },
            ]),
      ]}
    />
  );
}

export const TASK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_LABEL[p] }));
const RECURRENCE_OPTIONS = TASK_RECURRENCES.map((r) => ({
  value: r,
  label: r === 'none' ? 'Does not repeat' : `Repeats ${r}`,
}));
const SOURCE_OPTIONS = [
  { value: 'self', label: 'I found it myself' },
  { value: 'manager', label: 'My manager' },
  { value: 'verbal', label: 'Verbal request (call, WhatsApp, in person)' },
  { value: 'academic', label: 'Academic OS (support case, missing log)' },
];
const DUE_OPTIONS = TASK_DUE_FILTERS.map((d) => ({
  value: d,
  label: { overdue: 'Overdue', today: 'Due today', week: 'Due this week' }[d],
}));

type Db = Parameters<typeof globalSearch>[0];

/** Staff options the caller may assign to or filter by: yourself and your reports (all scope: everyone). */
async function scopedStaff(
  db: Db,
  user: AuthenticatedUser,
  permission: 'ops:tasks:read' | 'ops:tasks:write',
) {
  const [access, { staff, departments }] = await Promise.all([
    taskAccess(db, user, permission),
    formOptions(db),
  ]);
  return { staff: staff.filter((s) => coversOwner(access, s.value)), everyone: staff, departments };
}

/** Lead and student picks from the existing Admissions search (`rel` query). */
async function relatedFields(
  db: Db,
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

type Option = { value: string; label: string };
const ADVANCED = 'Assign, review and source (optional)';

/** The full "Log a task" form: quick fields first, assignment and request details after. */
function logTaskFields(
  related: FieldSpec[],
  assignable: Option[],
  everyone: Option[],
  departments: Option[],
  all: boolean,
): FieldSpec[] {
  return [
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
    ...(assignable.length > 1
      ? [
          {
            name: 'staffId',
            label: 'Owner',
            type: 'select' as const,
            options: assignable,
            hint: 'Empty: you.',
            section: ADVANCED,
          },
        ]
      : []),
    {
      name: 'reviewRequired',
      label: 'Needs review before it is closed',
      type: 'checkbox',
      section: ADVANCED,
    },
    {
      name: 'reviewerStaffId',
      label: 'Reviewer',
      type: 'select',
      options: everyone,
      hint: 'Review required with no reviewer: only an operations manager can close it.',
      section: ADVANCED,
    },
    { name: 'acceptanceCriteria', label: 'Done when', type: 'textarea', section: ADVANCED },
    {
      name: 'source',
      label: 'Where it came from',
      type: 'select',
      options: SOURCE_OPTIONS,
      section: ADVANCED,
    },
    {
      name: 'requesterStaffId',
      label: 'Requested by (staff)',
      type: 'select',
      options: everyone,
      section: ADVANCED,
    },
    {
      name: 'requesterNote',
      label: 'Requested by (someone else)',
      hint: 'Name and channel, e.g. "Parent of Sample Asha, by phone".',
      section: ADVANCED,
    },
    {
      name: 'backupStaffId',
      label: 'Backup',
      type: 'select',
      options: everyone,
      section: ADVANCED,
    },
    {
      name: 'departmentId',
      label: 'Department',
      type: 'select',
      options: departments,
      section: ADVANCED,
    },
    { name: 'dueOn', label: 'Due on another day', type: 'date', section: 'More (optional)' },
    { name: 'plannedStartOn', label: 'Planned start', type: 'date', section: 'More (optional)' },
    ...(all
      ? [
          {
            name: 'assignedByStaffId',
            label: 'Given by',
            type: 'select' as const,
            options: everyone,
            hint: 'Empty: you.',
            section: 'More (optional)',
          },
        ]
      : []),
    {
      name: 'linkedRef',
      label: 'Linked record in another module',
      hint: 'e.g. an Academic support case reference.',
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
  ];
}

/** Open work, grouped by where it stands; carried-forward tasks keep their earlier due date. */
const OPEN_GROUPS = ['in_progress', 'pending', 'in_review', 'blocked', 'on_hold'] as const;

export async function MyDay({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const write = can(user, 'ops:tasks:write');
  const adding = write && Boolean(sp.new);
  const r = await load(async (db) => {
    const [day, people, related] = await Promise.all([
      myDay(db, user, today).then(
        async (d) =>
          d && {
            ...d,
            rowOptions: write
              ? await rowStatusOptions(
                  db,
                  user,
                  [...d.open, ...d.carried].map((t) => t.id),
                )
              : undefined,
          },
      ),
      adding ? scopedStaff(db, user, 'ops:tasks:write') : null,
      adding ? relatedFields(db, user, sp.rel?.trim() || undefined) : [],
    ]);
    return { day, people, related };
  });
  if (!r.ok) return r.view;
  const { day, people, related } = r.data;
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
              <DayTable rows={rows} href={open} edit={day.rowOptions} />
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
      {adding && people ? (
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
            fields={logTaskFields(
              related,
              people.staff,
              people.everyone,
              people.departments,
              scopeFor(user, 'ops:tasks:write') === 'all',
            )}
          />
        </FormModal>
      ) : null}
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} /> : null}
    </div>
  );
}

const VIEWS = [
  { key: 'all', label: 'All tasks' },
  { key: 'ack', label: 'Awaiting acknowledgement' },
  { key: 'overdue', label: 'Overdue' },
] as const;

export async function AllTasks({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? 'all';
  const filters = {
    q: sp.q?.trim() || undefined,
    status: TASK_STATUSES.find((s) => s === sp.status),
    priority: TASK_PRIORITIES.find((p) => p === sp.priority),
    staffId: sp.staffId || undefined,
    departmentId: sp.departmentId || undefined,
    due: view === 'overdue' ? ('overdue' as const) : TASK_DUE_FILTERS.find((d) => d === sp.due),
    ack: view === 'ack' ? ('pending' as const) : undefined,
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
    page: Math.max(1, Number(sp.page) || 1),
  };
  const r = await load(async (db) => {
    const [list, people] = await Promise.all([
      listTasks(db, user, filters),
      scopedStaff(db, user, 'ops:tasks:read'),
    ]);
    return { list, people };
  });
  if (!r.ok) return r.view;
  const { list, people } = r.data;
  const now = new Date();
  const showOwner = scopeFor(user, 'ops:tasks:read') === 'all' || people.staff.length > 1;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={view === 'all' ? { tab: 'all' } : { tab: 'all', view }}
        search={{ name: 'q', label: 'Task title', value: sp.q }}
        filters={[
          ...(showOwner
            ? [
                {
                  name: 'staffId',
                  label: 'Owner',
                  type: 'select' as const,
                  options: people.staff,
                  value: filters.staffId,
                  anyLabel: 'Everyone I can see',
                },
              ]
            : []),
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: people.departments,
            value: filters.departmentId,
          },
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
            options: PRIORITY_OPTIONS,
            value: filters.priority,
          },
          ...(view === 'overdue'
            ? []
            : [
                {
                  name: 'due',
                  label: 'Due',
                  type: 'select' as const,
                  options: DUE_OPTIONS,
                  value: filters.due,
                },
              ]),
          { name: 'from', label: 'Due from', type: 'date', value: filters.from },
          { name: 'to', label: 'Due to', type: 'date', value: filters.to },
        ]}
      />
      <Tabs
        idBase="task-tracker"
        label="Tracker views"
        selected={view}
        items={VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          href: listHref(BASE, sp, {
            view: v.key === 'all' ? undefined : v.key,
            page: undefined,
            open: undefined,
          }),
        }))}
      >
        <RecordTable
          caption={`${list.total} task${list.total === 1 ? '' : 's'}`}
          rows={list.rows}
          rowKey={(t) => t.id}
          rowHref={(t) => listHref(BASE, sp, { open: t.id })}
          empty={
            <EmptyState
              title={view === 'ack' ? 'Every task is acknowledged' : 'No tasks match'}
              description={
                view === 'ack'
                  ? 'Assigned work shows here until its owner acknowledges it.'
                  : 'Clear a filter, or log a task on My day.'
              }
            />
          }
          columns={[
            { key: 'title', header: 'Task' },
            ...(showOwner ? [{ key: 'staffName' as const, header: 'Owner' }] : []),
            { key: 'priority', header: 'Priority', render: (t) => TASK_LABEL[t.priority] },
            { key: 'due', header: 'Due (IST)', render: (t) => dueLabel(t, now) },
            {
              key: 'status',
              header: 'Status',
              render: (t) => (
                <>
                  <TaskBadge status={t.status} />
                  {t.status !== 'done' && t.status !== 'cancelled' ? (
                    <AckBadge at={t.acknowledgedAt} />
                  ) : null}
                  {t.isSample ? (
                    <span className="el-badge el-badge-sample">Sample data</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'progress',
              header: '% done (self-reported)',
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
      </Tabs>
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} /> : null}
    </div>
  );
}

/** The list's pop-up: the task's facts; actions, updates and history are on the full page. */
async function TaskModal({ user, id, sp }: { user: AuthenticatedUser; id: string; sp: Params }) {
  const r = await load((db) => taskDetail(db, user, id));
  if (!r.ok) return r.view;
  const t = r.data;
  return (
    <RecordModal
      id="task-modal"
      title={t.title}
      meta={
        <>
          <TaskBadge status={t.status} />
          <AckBadge at={t.acknowledgedAt} />
        </>
      }
      fullHref={`${BASE}/${t.id}`}
      closeHref={listHref(BASE, sp, { open: undefined })}
      returnId={t.id}
    >
      <div className="el-stack">
        <ButtonLink variant="primary" href={`${BASE}/${t.id}`}>
          Open the task to act, log work or see its history
        </ButtonLink>
        <TaskFacts d={t} level={3} />
      </div>
    </RecordModal>
  );
}
