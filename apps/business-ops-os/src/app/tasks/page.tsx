import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { TASK_STATUS_LABELS, type TaskStatus } from '../../domain';
import { formOptions } from '../../server/options';
import { searchTasks, type TaskView } from '../../server/tasks';
import { taskSearchQuery, type TaskSearchQuery } from '../../server/work-schemas';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

const VIEWS: { key: TaskView; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'awaiting_review', label: 'Awaiting review' },
  { key: 'open', label: 'All open' },
  { key: 'all', label: 'All incl. closed' },
];
const ROLES = [
  { value: 'any', label: 'Any role' },
  { value: 'owner', label: 'Owner' },
  { value: 'accountable', label: 'Accountable' },
  { value: 'backup', label: 'Backup' },
] as const;
const PAGE_SIZE = 50;
const JOBS = [
  ['task-reminders', 'Send task reminders'],
  ['task-escalations', 'Run escalations'],
  ['follow-up-reminders', 'Send follow-up reminders'],
  ['enrolment-replies', 'Process Academic OS replies'],
] as const;

function href(q: Partial<TaskSearchQuery>, page?: number) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, page: page ?? q.page }))
    if (v !== undefined && v !== '' && k !== 'pageSize') p.set(k, String(v));
  return `/ops/tasks?${p.toString()}`;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:tasks:read', '/ops/tasks');
  const sp = await searchParams;
  const parsed = taskSearchQuery.safeParse({ ...sp, view: sp.view ?? 'mine' });
  const query: TaskSearchQuery = parsed.success
    ? parsed.data
    : { view: 'mine', role: 'any', page: 1 };
  return (
    <Frame access={access} active="tasks">
      <PageHeader
        title="Tasks"
        description="Owner, accountable owner and backup; due dates in IST; dependencies; supervisor review; escalation L1–L4 (thresholds are a proposal)."
      />
      <nav className="el-subnav" aria-label="Task views">
        {VIEWS.map((v) => (
          <a
            key={v.key}
            href={`/ops/tasks?view=${v.key}`}
            aria-current={v.key === query.view ? 'page' : undefined}
          >
            {v.label}
          </a>
        ))}
      </nav>
      {!parsed.success ? (
        <p className="el-field-error" role="alert">
          Some filters were not valid and were ignored.
        </p>
      ) : null}
      <Section>
        <TaskList user={access.user} query={query} />
      </Section>
      {can(access.user, 'ops:tasks:write') ? (
        <Section label="Loading form…">
          <NewTask managerView={can(access.user, 'ops:jobs:run')} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function TaskList({ user, query }: { user: AuthenticatedUser; query: TaskSearchQuery }) {
  const r = await load(async (db) => ({
    result: await searchTasks(db, user, { ...query, page: query.page ?? 1, pageSize: PAGE_SIZE }),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  const { result, options } = r.data;
  const filtered = Boolean(query.departmentId || query.staffId || query.q || query.role !== 'any');
  return (
    <div className="el-stack">
      <form method="get" action="/ops/tasks" className="el-inline-form" aria-label="Filter tasks">
        <input type="hidden" name="view" value={query.view} />
        <div className="el-field">
          <label htmlFor="tf-q">Code or title</label>
          <input id="tf-q" name="q" className="el-input" defaultValue={query.q ?? ''} />
        </div>
        <div className="el-field">
          <label htmlFor="tf-dept">Department</label>
          <select
            id="tf-dept"
            name="departmentId"
            className="el-select"
            defaultValue={query.departmentId ?? ''}
          >
            <option value="">All departments</option>
            {options.departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {query.view !== 'mine' ? (
          <div className="el-field">
            <label htmlFor="tf-staff">Person</label>
            <select
              id="tf-staff"
              name="staffId"
              className="el-select"
              defaultValue={query.staffId ?? ''}
            >
              <option value="">Anyone</option>
              {options.staff.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="el-field">
          <label htmlFor="tf-role">{query.view === 'mine' ? 'My role' : 'Their role'}</label>
          <select id="tf-role" name="role" className="el-select" defaultValue={query.role}>
            {ROLES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="el-button el-button-secondary">
          Apply filters
        </button>
        {filtered ? <a href={`/ops/tasks?view=${query.view}`}>Clear filters</a> : null}
      </form>
      <DataTable
        caption={`${result.total} task(s)${result.pages > 1 ? ` — page ${result.page} of ${result.pages}` : ''}`}
        rows={result.items}
        rowKey={(t) => t.id}
        empty={
          <EmptyState
            title={filtered ? 'No tasks match these filters' : 'Nothing in this view'}
            description={filtered ? 'Clear the filters or pick another view.' : undefined}
          />
        }
        columns={[
          {
            key: 'code',
            header: 'Task',
            render: (t) => <a href={`/ops/tasks/${t.id}`}>{t.code}</a>,
          },
          { key: 'title', header: 'Title' },
          { key: 'departmentName', header: 'Department', render: (t) => t.departmentName ?? '—' },
          {
            key: 'ownerName',
            header: 'Owner',
            render: (t) => t.ownerName ?? <StatusBadge tone="warning">No owner</StatusBadge>,
          },
          { key: 'backupName', header: 'Backup', render: (t) => t.backupName ?? '—' },
          {
            key: 'dueDate',
            header: 'Due',
            render: (t) =>
              t.dueDate ? (
                fmtDate(t.dueDate)
              ) : (
                <StatusBadge tone="warning">No due date</StatusBadge>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (t) => (
              <StatusBadge tone={statusTone(t.status)}>
                {TASK_STATUS_LABELS[t.status as TaskStatus]}
              </StatusBadge>
            ),
          },
          {
            key: 'flags',
            header: 'Flags',
            render: (t) => (
              <>
                {t.flags.includes('overdue') ? (
                  <StatusBadge tone="danger">Overdue {t.daysOverdue}d</StatusBadge>
                ) : null}
                {t.flags.includes('due_today') ? (
                  <StatusBadge tone="info">Due today</StatusBadge>
                ) : null}
                {t.openEscalationLevel ? (
                  <StatusBadge tone="warning">L{t.openEscalationLevel}</StatusBadge>
                ) : null}
                {t.awaitingReview ? <StatusBadge tone="info">Awaiting review</StatusBadge> : null}
              </>
            ),
          },
        ]}
      />
      {result.pages > 1 ? (
        <nav className="el-subnav" aria-label="Pages">
          {result.page > 1 ? <a href={href(query, result.page - 1)}>Previous page</a> : null}
          <span>
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? <a href={href(query, result.page + 1)}>Next page</a> : null}
        </nav>
      ) : null}
    </div>
  );
}

async function NewTask({ managerView }: { managerView: boolean }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <div className="el-grid">
      <Card
        title="New task"
        description={
          managerView
            ? 'Assign owner, accountable owner and backup.'
            : 'Tasks you create are owned by you.'
        }
      >
        <ActionForm
          action="/ops/api/v1/tasks"
          submitLabel="Create task"
          redirectTo="/ops/tasks/{id}"
          fields={[
            { name: 'title', label: 'Title', required: true },
            { name: 'description', label: 'Description', type: 'textarea' },
            ...(managerView
              ? (
                  [
                    ['ownerStaffId', 'Owner', r.data.staff],
                    ['accountableStaffId', 'Accountable', r.data.staff],
                    ['backupStaffId', 'Backup', r.data.staff],
                    ['departmentId', 'Department', r.data.departments],
                  ] as const
                ).map(([name, label, options]) => ({
                  name,
                  label,
                  type: 'select' as const,
                  options,
                }))
              : []),
            { name: 'dueDate', label: 'Due date', type: 'date' },
            {
              name: 'priority',
              label: 'Priority',
              type: 'select',
              required: true,
              defaultValue: 'medium',
              options: ['low', 'medium', 'high', 'critical'].map((v) => ({ value: v, label: v })),
            },
          ]}
        />
      </Card>
      {managerView ? (
        <Card
          title="Run jobs"
          description="No scheduler yet (wave 3): run these by hand. Each run is idempotent."
        >
          {JOBS.map(([job, label]) => (
            <ActionForm
              key={job}
              action={`/ops/api/v1/jobs/${job}`}
              submitLabel={label}
              variant="secondary"
            />
          ))}
        </Card>
      ) : null}
    </div>
  );
}
