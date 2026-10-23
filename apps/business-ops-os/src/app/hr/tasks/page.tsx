/**
 * HR → Tasks (owner brief 23 Oct 2026 §8, §18): every task in HR's staff scope, filtered by
 * department, employee, deadline, priority and status; tabs All / Due soon / Overdue / Submitted
 * / Approved with counts from the list's own WHERE; a table by default, or a board by status.
 * `?new=1` assigns a task, `?open=<id>` inspects one.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { ButtonLink, EmptyState, PageHeader, Tabs } from '@elevate/shared-ui';
import { isIsoDate } from '../../../domain/dates';
import { TASK_PRIORITIES, TASK_STATUSES, taskStatusLabel } from '../../../domain/staff-tasks';
import { can } from '@elevate/authorization';
import { aiBlocked } from '../../../server/ai-drafts';
import { staffIdForUser } from '../../../server/context';
import { listTeachingAssignments } from '../../../server/hr-assignments';
import { relatedLabelOf } from '../../../server/task-create';
import { listTasks, type TaskListRow } from '../../../server/staff-tasks';
import { HR_TASK_TABS, hrTabCounts } from '../../../server/staff-tasks-hr';
import { taskListQuery } from '../../../server/staff-tasks-schemas';
import { ActionForm } from '../../../ui/action-form';
import { TaskBriefAssist } from '../../../ui/ai-draft';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { scopedStaff } from '../../tasks/_components/log-task';
import {
  Deadline,
  deliveryText,
  PRIORITY_OPTIONS,
  TASK_LABEL,
  TaskBadge,
  type Params,
} from '../../tasks/_components/task-common';
import { TaskModal } from '../../tasks/_components/task-modal';
import { STATUS_OPTIONS } from '../../tasks/_components/task-views';
import { newTaskFields } from './new-task';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR tasks' };

const BASE = '/ops/hr/tasks';

export default async function HrTasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:review', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-tasks">
      <PageHeader
        title="Tasks"
        description="Work HR assigns to teachers and marketing staff, and where each task stands."
        actions={
          <ButtonLink variant="primary" href={listHref(BASE, sp, { new: '1', open: undefined })}>
            Assign a task
          </ButtonLink>
        }
      />
      <Section label="Loading tasks…">
        <HrTasks user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

const pick = <T extends string>(list: readonly T[], v?: string) => list.find((x) => x === v);

async function HrTasks({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const tab = HR_TASK_TABS.find((t) => t.key === sp.tab) ?? HR_TASK_TABS[0];
  const filters = {
    q: sp.q?.trim() || undefined,
    staffId: sp.staffId || undefined,
    departmentId: sp.departmentId || undefined,
    priority: pick(TASK_PRIORITIES, sp.priority),
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
    flag: sp.flag === 'blocked' ? ('blocked' as const) : undefined,
  };
  const status = pick(TASK_STATUSES, sp.status);
  const due = sp.due === 'today' ? ('today' as const) : undefined;
  const adding = Boolean(sp.new);
  const r = await load(async (db) => {
    const query = taskListQuery.parse({
      ...filters,
      status,
      due,
      ...tab.query,
      page: Math.max(1, Number(sp.page) || 1),
    });
    const [list, counts, people, self, related, ai] = await Promise.all([
      listTasks(db, user, query),
      hrTabCounts(db, user, { ...filters, status, due }),
      scopedStaff(db, user, adding ? 'ops:tasks:write' : 'ops:tasks:read'),
      staffIdForUser(db, user.id),
      adding ? relatedOptions(db, user) : [],
      adding ? aiBlocked(db, user, 'taskBrief') : null,
    ]);
    return { list, counts, people, self, related, ai };
  });
  if (!r.ok) return r.view;
  const { list, counts, people, self, related, ai } = r.data;
  const board = sp.view === 'board';
  const close = listHref(BASE, sp, { new: undefined });
  const open = (t: { id: string }) => listHref(BASE, sp, { open: t.id });
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={Object.fromEntries(
          Object.entries({ tab: sp.tab, view: sp.view }).filter(
            (e): e is [string, string] => !!e[1],
          ),
        )}
        search={{ name: 'q', label: 'Task title', value: sp.q }}
        filters={[
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: people.departments,
            value: filters.departmentId,
          },
          {
            name: 'staffId',
            label: 'Employee',
            type: 'select',
            options: people.staff,
            value: filters.staffId,
          },
          { name: 'from', label: 'Deadline from', type: 'date', value: filters.from },
          { name: 'to', label: 'Deadline to', type: 'date', value: filters.to },
          {
            name: 'priority',
            label: 'Priority',
            type: 'select',
            options: PRIORITY_OPTIONS,
            value: filters.priority,
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: STATUS_OPTIONS,
            value: status,
          },
        ]}
      />
      <p className="el-card-actions">
        <a href={listHref(BASE, sp, { view: board ? undefined : 'board', page: undefined })}>
          {board ? 'Show as a table' : 'Show as a board by status'}
        </a>
        {filters.flag ? (
          <a href={listHref(BASE, sp, { flag: undefined })}>
            Showing blocked tasks only · show all
          </a>
        ) : null}
      </p>
      <Tabs
        idBase="hr-tasks"
        label="Task views"
        selected={tab.key}
        items={HR_TASK_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: counts[t.key],
          href: listHref(BASE, sp, {
            tab: t.key === 'all' ? undefined : t.key,
            page: undefined,
            open: undefined,
          }),
        }))}
      >
        {board ? (
          <Board rows={list.rows} open={open} />
        ) : (
          <HrTaskTable rows={list.rows} total={list.total} open={open} />
        )}
        <Pager
          basePath={BASE}
          params={sp}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </Tabs>
      <details className="el-explain">
        <summary>How these lists are defined</summary>
        <p>
          Due soon: still with the assignee and due today or in the next two days. Overdue: still
          with the assignee (assigned, in progress or changes requested) and past the deadline in
          force; submitted work is never overdue. Submitted: waiting for a review decision.
          Approved: closed (approved, or done where no review was required). A task given to several
          people counts once per person.
        </p>
      </details>
      {adding ? (
        <FormModal id="assign-task" title="Assign a task" meta="Times are IST." closeHref={close}>
          {people.staff.length ? (
            // The AI brief only fills the form's fields by name; the person checks and saves.
            <TaskBriefAssist api="/ops/api/v1/ai/task-brief" blocked={ai}>
              <ActionForm
                action="/ops/api/v1/staff-tasks"
                submitLabel="Assign task"
                redirectTo="/ops/tasks/{id}"
                secondary={<a href={close}>Cancel</a>}
                fields={newTaskFields(
                  people.staff,
                  people.everyone,
                  people.departments,
                  self,
                  related,
                )}
              />
            </TaskBriefAssist>
          ) : (
            <EmptyState
              title="Nobody you can assign to"
              description="HR assigns work to the staff of the departments in HR settings (Staff HR manages)."
            />
          )}
        </FormModal>
      ) : null}
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} base="/ops" listPath={BASE} /> : null}
    </div>
  );
}

/** Batch and subject choices from Academic's teaching assignments (I5); none when unavailable. */
async function relatedOptions(
  db: Parameters<typeof listTeachingAssignments>[0],
  user: AuthenticatedUser,
) {
  if (!can(user, 'ops:teaching_assignments:read')) return [];
  // shortcut: the first page (25) of assignments; filter by assignee when lists grow.
  const r = await listTeachingAssignments(db, user, {});
  if (r.status !== 'available') return [];
  const options = new Map<string, string>();
  for (const a of r.data.items) {
    if (a.batchId)
      options.set(`batch:${a.batchId}`, `${a.teacherName} — ${relatedLabelOf('batch', a)}`);
    if (a.subjectId)
      options.set(`subject:${a.subjectId}`, `${a.teacherName} — ${relatedLabelOf('subject', a)}`);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

const group = (t: TaskListRow) =>
  t.children
    ? ` · ${t.childrenDone} of ${t.children} approved`
    : t.parentTaskId
      ? ' · part of a group'
      : '';

function HrTaskTable({
  rows,
  total,
  open,
}: {
  rows: TaskListRow[];
  total: number;
  open: (t: TaskListRow) => string;
}) {
  return (
    <RecordTable
      caption={`${total} task${total === 1 ? '' : 's'}`}
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={open}
      empty={<EmptyState title="No tasks match" description="Clear a filter, or assign a task." />}
      columns={[
        { key: 'title', header: 'Task', render: (t) => `${t.title}${group(t)}` },
        { key: 'staffName', header: 'Assignee' },
        { key: 'due', header: 'Deadline (IST)', render: (t) => <Deadline t={t} /> },
        { key: 'priority', header: 'Priority', render: (t) => TASK_LABEL[t.priority] },
        {
          key: 'status',
          header: 'Status',
          render: (t) => (
            <>
              <TaskBadge
                status={t.status}
                reviewRequired={t.reviewRequired}
                blocked={t.blockedKind}
              />
              {t.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
            </>
          ),
        },
        { key: 'delivery', header: 'Delivery', render: deliveryText },
      ]}
    />
  );
}

const BOARD = [
  'draft',
  'pending',
  'in_progress',
  'changes_requested',
  'in_review',
  'done',
  'cancelled',
] as const;

/** The current page grouped by status (a view of the same rows, not another query). */
function Board({ rows, open }: { rows: TaskListRow[]; open: (t: TaskListRow) => string }) {
  return (
    <div className="ops-panels">
      {BOARD.map((s) => {
        const items = rows.filter((t) => t.status === s);
        return (
          <Segment key={s} title={`${taskStatusLabel(s, s === 'done')} (${items.length})`}>
            {items.length ? (
              <ul>
                {items.map((t) => (
                  <li key={t.id}>
                    <a href={open(t)}>{t.title}</a> · {t.staffName}
                    {group(t)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="el-field-hint">None on this page.</p>
            )}
          </Segment>
        );
      })}
    </div>
  );
}
