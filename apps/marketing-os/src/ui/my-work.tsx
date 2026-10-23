/** Tables for a marketer's own work (My day, Deliverables): tasks and content, no data access. */
import type { ReactNode } from 'react';
import { taskStatusLabel, type listTasks } from '@elevate/business-ops-os/work';
import { DataTable, EmptyState } from '@elevate/shared-ui';
import {
  TASK_PUBLISHED_TEXT,
  contentDeliverableStates,
  dueText,
  formatIst,
  modulePath,
} from '../domain';
import type { myContentItems } from '../server';
import { ContentStateBadge } from './badges';

export type TaskRow = Awaited<ReturnType<typeof listTasks>>['rows'][number];
type ContentRow = Awaited<ReturnType<typeof myContentItems>>['rows'][number];

const taskLink = (t: TaskRow) => <a href={modulePath(`tasks/${t.id}`)}>{t.title}</a>;
const status = (t: TaskRow) => taskStatusLabel(t.status, t.reviewRequired);

/** Tasks with their deadline and status (My day). */
export function TaskTable({ rows, empty }: { rows: readonly TaskRow[]; empty: string }) {
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(t) => t.id}
      empty={<EmptyState title={empty} />}
      columns={[
        { key: 'task', header: 'Task', render: taskLink },
        { key: 'due', header: 'Deadline (IST)', render: (t) => dueText(t.dueOn, t.dueTime) },
        { key: 'status', header: 'Status', render: status },
      ]}
    />
  );
}

/** Deliverables from my tasks: what is expected, its review state, and never "published". */
export function TaskDeliverables({ rows }: { rows: readonly TaskRow[] }) {
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(t) => t.id}
      empty={<EmptyState title="No tasks assigned to you" />}
      columns={[
        { key: 'task', header: 'Task', render: taskLink },
        { key: 'category', header: 'Category', render: (t) => t.category ?? 'Not recorded' },
        {
          key: 'expected',
          header: 'Expected deliverable',
          render: (t) => t.expectedDeliverable ?? 'Not recorded',
        },
        { key: 'due', header: 'Deadline (IST)', render: (t) => dueText(t.dueOn, t.dueTime) },
        { key: 'approved', header: 'Approved', render: status },
        { key: 'published', header: 'Published externally', render: () => TASK_PUBLISHED_TEXT },
      ]}
    />
  );
}

/** Content items I created or am assigned to, with review and publishing as separate columns. */
export function ContentDeliverables({ rows }: { rows: readonly ContentRow[] }) {
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(c) => c.id}
      empty={<EmptyState title="No content assigned to you" />}
      columns={[
        {
          key: 'title',
          header: 'Content',
          render: (c) => <a href={modulePath(`content/${c.id}`)}>{c.title}</a>,
        },
        { key: 'idea', header: 'Idea', render: (c) => c.ideaCode ?? 'Not recorded' },
        { key: 'state', header: 'State', render: (c) => <ContentStateBadge state={c.state} /> },
        {
          key: 'approved',
          header: 'Approved',
          render: (c) => contentDeliverableStates(c.state).review,
        },
        {
          key: 'published',
          header: 'Published externally',
          render: (c) => contentDeliverableStates(c.state).published,
        },
        { key: 'updated', header: 'Last change', render: (c) => formatIst(c.updatedAt) },
      ]}
    />
  );
}

/** Previous/next links for one list on a page (`name` is its page parameter). */
export function PageLinks(p: {
  path: string;
  name: string;
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string>;
}): ReactNode {
  if (p.total <= p.pageSize) return null;
  const href = (n: number) =>
    `${p.path}?${new URLSearchParams({ ...p.params, [p.name]: String(n) })}`;
  const last = Math.ceil(p.total / p.pageSize);
  return (
    <nav className="el-inline-form" aria-label="Pages">
      <span>
        Showing {(p.page - 1) * p.pageSize + 1}–{Math.min(p.total, p.page * p.pageSize)} of{' '}
        {p.total}
      </span>
      {p.page > 1 ? <a href={href(p.page - 1)}>Previous page</a> : null}
      {p.page < last ? <a href={href(p.page + 1)}>Next page</a> : null}
    </nav>
  );
}
