/**
 * The task tracker (`?tab=all`): every task the caller may see, with filters. Shared pieces live
 * in task-common.tsx (re-exported here for existing importers), My Tasks in my-tasks.tsx.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { scopeFor } from '@elevate/authorization';
import { EmptyState, Tabs } from '@elevate/shared-ui';
import { isIsoDate } from '../../../domain/dates';
import { TASK_PRIORITIES, TASK_STATUSES, taskStatusLabel } from '../../../domain/staff-tasks';
import { listTasks } from '../../../server/staff-tasks';
import { TASK_DUE_FILTERS } from '../../../server/staff-tasks-schemas';
import { load } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { DUE_OPTIONS, scopedStaff } from './log-task';
import { AckBadge } from './task-detail';
import {
  dueLabel,
  PRIORITY_OPTIONS,
  TASK_LABEL,
  TaskBadge,
  taskPaths,
  type Params,
} from './task-common';
import { TaskModal } from './task-modal';

export {
  dueLabel,
  dueText,
  PRIORITY_OPTIONS,
  TASK_LABEL,
  TaskBadge,
  taskPaths,
  type Params,
} from './task-common';
export { MyDay } from './my-tasks';

export const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: taskStatusLabel(s) }));

const VIEWS = [
  { key: 'all', label: 'All tasks' },
  { key: 'ack', label: 'Awaiting acknowledgement' },
  { key: 'overdue', label: 'Overdue' },
] as const;

export async function AllTasks({
  user,
  sp,
  base,
}: {
  user: AuthenticatedUser;
  sp: Params;
  base: string;
}) {
  const BASE = taskPaths(base).tasks;
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
                  <TaskBadge
                    status={t.status}
                    reviewRequired={t.reviewRequired}
                    blocked={t.blockedKind}
                  />
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
            { key: 'reason', header: 'Reason', render: (t) => t.blockedReason ?? t.reason ?? '' },
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
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} base={base} /> : null}
    </div>
  );
}
