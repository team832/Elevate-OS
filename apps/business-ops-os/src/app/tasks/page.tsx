import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { TASK_STATUS_LABELS, type TaskStatus } from '../../domain';
import { formOptions } from '../../server/options';
import { listTasks, type TaskView } from '../../server/tasks';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

const VIEWS: { key: TaskView; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'open', label: 'All open' },
  { key: 'all', label: 'All incl. closed' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:tasks:read', '/ops/tasks');
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? 'mine';
  return (
    <Frame access={access} active="tasks">
      <PageHeader
        title="Tasks"
        description="Owner, accountable owner and backup; due dates in IST; dependencies; escalation L1–L4 (thresholds are a proposal)."
      />
      <nav className="el-subnav" aria-label="Task views">
        {VIEWS.map((v) => (
          <a
            key={v.key}
            href={`/ops/tasks?view=${v.key}`}
            aria-current={v.key === view ? 'page' : undefined}
          >
            {v.label}
          </a>
        ))}
      </nav>
      <Section>
        <TaskList user={access.user} view={view} />
      </Section>
      {can(access.user, 'ops:tasks:write') ? (
        <Section label="Loading form…">
          <NewTask managerView={can(access.user, 'ops:jobs:run')} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function TaskList({ user, view }: { user: AuthenticatedUser; view: TaskView }) {
  const r = await load((db) => listTasks(db, user, view));
  if (!r.ok) return r.view;
  return (
    <DataTable
      caption={`${r.data.length} task(s)`}
      rows={r.data}
      rowKey={(t) => t.id}
      empty={<EmptyState title="Nothing in this view" />}
      columns={[
        { key: 'code', header: 'Task', render: (t) => <a href={`/ops/tasks/${t.id}`}>{t.code}</a> },
        { key: 'title', header: 'Title' },
        {
          key: 'ownerName',
          header: 'Owner',
          render: (t) => t.ownerName ?? <StatusBadge tone="warning">No owner</StatusBadge>,
        },
        {
          key: 'dueDate',
          header: 'Due',
          render: (t) =>
            t.dueDate ? fmtDate(t.dueDate) : <StatusBadge tone="warning">No due date</StatusBadge>,
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
            </>
          ),
        },
      ]}
    />
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
              ? [
                  {
                    name: 'ownerStaffId',
                    label: 'Owner',
                    type: 'select' as const,
                    options: r.data.staff,
                  },
                  {
                    name: 'accountableStaffId',
                    label: 'Accountable',
                    type: 'select' as const,
                    options: r.data.staff,
                  },
                  {
                    name: 'backupStaffId',
                    label: 'Backup',
                    type: 'select' as const,
                    options: r.data.staff,
                  },
                  {
                    name: 'departmentId',
                    label: 'Department',
                    type: 'select' as const,
                    options: r.data.departments,
                  },
                ]
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
          <ActionForm
            action="/ops/api/v1/jobs/task-escalations"
            submitLabel="Run escalations"
            variant="secondary"
          />
          <ActionForm
            action="/ops/api/v1/jobs/follow-up-reminders"
            submitLabel="Send follow-up reminders"
            variant="secondary"
          />
          <ActionForm
            action="/ops/api/v1/jobs/enrolment-replies"
            submitLabel="Process Academic OS replies"
            variant="secondary"
          />
        </Card>
      ) : null}
    </div>
  );
}
