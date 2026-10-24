/**
 * My Tasks (owner brief 23 Oct 2026 §9, §18), shown in Business Operations, Academic OS and
 * Marketing OS (D-073): per task the deadline, expected deliverable, status, latest reviewer
 * comment and one obvious next action. Self-logged work, the quick add and the end-of-day link
 * stay (brief 2 §5). Drafts and the parents of multi-assignments never show here.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import { ButtonLink, EmptyState } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import { missingReasons, type EodItem } from '../../../domain/staff-tasks';
import { listTasks, myDay, NO_STAFF_RECORD, type TaskListRow } from '../../../server/staff-tasks';
import { taskListQuery } from '../../../server/staff-tasks-schemas';
import { staffIdForUser } from '../../../server/context';
import { loadSettings } from '../../../server/settings';
import { ActionForm } from '../../../ui/action-form';
import { StatCard } from '../../../ui/charts';
import { load } from '../../../ui/frame';
import { listHref, SearchPanel } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { DueWork } from '../../../ui/task-notices';
import { logTaskFields, relatable, relatedFields, scopedStaff } from './log-task';
import { QuickAdd } from './quick-add';
import { Deadline, NextActionButton, TaskBadge, taskPaths, type Params } from './task-common';
import { TaskModal } from './task-modal';

const DECISION = {
  changes_requested: 'Changes requested',
  approved: 'Approved',
  comment: 'Comment',
};

/** Task, deadline, status, latest reviewer comment and the next step, one row per task. */
export function MyTaskTable({
  rows,
  base,
  href,
  empty,
  closedBy,
}: {
  rows: TaskListRow[];
  base: string;
  closedBy: 'owner' | 'manager';
  href: (t: TaskListRow) => string;
  empty: string;
}) {
  return (
    <RecordTable
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={href}
      empty={empty}
      columns={[
        {
          key: 'title',
          header: 'Task',
          render: (t) => (
            <>
              {t.title}
              {t.expectedDeliverable ? (
                <span className="el-field-hint"> · Deliverable: {t.expectedDeliverable}</span>
              ) : null}
            </>
          ),
        },
        { key: 'due', header: 'Deadline (IST)', render: (t) => <Deadline t={t} /> },
        {
          key: 'status',
          header: 'Status',
          render: (t) => (
            <TaskBadge
              status={t.status}
              reviewRequired={t.reviewRequired}
              blocked={t.blockedKind}
            />
          ),
        },
        {
          key: 'comment',
          header: 'Latest reviewer comment',
          render: (t) =>
            t.latestNote
              ? `${DECISION[t.latestDecision as keyof typeof DECISION] ?? 'Note'}: ${t.latestNote}`
              : 'None yet',
        },
        {
          key: 'next',
          header: 'Next step',
          render: (t) => <NextActionButton t={t} base={base} closedBy={closedBy} />,
        },
      ]}
    />
  );
}

export async function MyDay({
  user,
  sp,
  base,
}: {
  user: AuthenticatedUser;
  sp: Params;
  base: string;
}) {
  const { tasks: BASE, api: API } = taskPaths(base);
  const today = istToday(new Date());
  const write = can(user, 'ops:tasks:write');
  const adding = write && Boolean(sp.new);
  const r = await load(async (db) => {
    const self = await staffIdForUser(db, user.id);
    const q = (status?: string) =>
      taskListQuery.parse({ staffId: self, open: '1', groups: 'exclude', status, page: 1 });
    const [day, open, waiting, people, related, settings] = await Promise.all([
      myDay(db, user, today),
      self ? listTasks(db, user, q(), 50) : null,
      self ? listTasks(db, user, q('in_review'), 50) : null,
      adding ? scopedStaff(db, user, 'ops:tasks:write') : null,
      adding && relatable(user) ? relatedFields(db, user, sp.rel?.trim() || undefined) : [],
      loadSettings(db),
    ]);
    const closedBy = settings['tasks.completion_without_reviewer'].value.closedBy;
    return { day, open, waiting, people, related, closedBy };
  });
  if (!r.ok) return r.view;
  const { day, open, waiting, people, related, closedBy } = r.data;
  if (!day || !open || !waiting)
    return <EmptyState title="Your tasks cannot be shown" description={NO_STAFF_RECORD} />;
  const c = day.counts;
  const href = (t: { id: string }) => listHref(BASE, sp, { open: t.id });
  const close = listHref(BASE, sp, { new: undefined, rel: undefined });
  const todo = open.rows.filter((t) => t.status !== 'in_review');
  const missing = missingReasons(day).length;
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Your tasks in numbers">
        <li>
          <StatCard
            label="To do"
            value={todo.length}
            note="Assigned, in progress or changes requested"
          />
        </li>
        <li>
          <StatCard label="Overdue" value={c.overdue} />
        </li>
        <li>
          <StatCard label="Waiting for review" value={waiting.total} />
        </li>
        <li>
          <StatCard label="Done today" value={c.done} />
        </li>
      </ul>
      <DueWork user={user} base={base} />
      {write ? <QuickAdd action={API} version={`${open.total}-${c.done}`} /> : null}
      <Segment title={`To do (${todo.length})`} flush>
        <MyTaskTable
          rows={todo}
          base={base}
          closedBy={closedBy}
          href={href}
          empty="Nothing waiting on you. New work appears here the moment it is assigned."
        />
      </Segment>
      {waiting.rows.length ? (
        <Segment title={`Submitted, waiting for review (${waiting.total})`} flush>
          <MyTaskTable rows={waiting.rows} base={base} href={href} empty="" closedBy={closedBy} />
        </Segment>
      ) : null}
      <Segment title={`Done today (${c.done})`} flush>
        <DoneList rows={day.done} href={href} />
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
          {relatable(user) ? (
            <SearchPanel
              action={BASE}
              hidden={{ new: '1' }}
              search={{ name: 'rel', label: 'Link to a lead or student (optional)', value: sp.rel }}
              submitLabel="Find"
            />
          ) : null}
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
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} base={base} /> : null}
    </div>
  );
}

function DoneList({ rows, href }: { rows: EodItem[]; href: (t: EodItem) => string }) {
  return (
    <RecordTable
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={href}
      empty="Nothing completed yet today."
      columns={[
        { key: 'title', header: 'Task' },
        { key: 'status', header: 'Status', render: (t) => <TaskBadge status={t.status} /> },
      ]}
    />
  );
}
