/**
 * HR task figures (owner brief 23 Oct 2026 §6, §18): the HR Overview counts and the /hr/tasks tab
 * counts, all from the list's own WHERE (staff-tasks `listWhere`) so a count and the list it
 * links to always agree. Scope = the reader's task scope (HR: hr.staff_scope_departments).
 * Parent tasks of a multi-assignment are containers and are not counted.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { opsStaffTasks as tasks, type Database } from '@elevate/database';
import { istToday } from '../domain/dates';
import type { Actor } from './context';
import { dueFilter, listWhere } from './staff-tasks';
import type { TaskListQuery } from './staff-tasks-schemas';
import { taskAccess } from './task-store';

const TASKS = '/ops/hr/tasks';
const counted = (cond: SQL | undefined) =>
  sql<number>`count(*) filter (where ${cond ?? sql`true`})`.mapWith(Number);

/** HR tabs (brief §18) and the list filter each one stands for. */
export const HR_TASK_TABS = [
  { key: 'all', label: 'All', query: {} },
  { key: 'soon', label: 'Due soon', query: { due: 'soon' } },
  { key: 'overdue', label: 'Overdue', query: { due: 'overdue' } },
  { key: 'submitted', label: 'Submitted', query: { status: 'in_review' } },
  { key: 'approved', label: 'Approved', query: { status: 'done' } },
] as const satisfies readonly { key: string; label: string; query: Partial<TaskListQuery> }[];
export type HrTaskTab = (typeof HR_TASK_TABS)[number]['key'];

const tabCondition = (q: Partial<TaskListQuery>, now: Date) =>
  and(q.status ? eq(tasks.status, q.status) : undefined, dueFilter(q.due, now));

/** Count per tab under the page's other filters (one query). */
export async function hrTabCounts(
  db: Database,
  user: Actor,
  filters: Partial<TaskListQuery>,
): Promise<Record<HrTaskTab, number>> {
  const access = await taskAccess(db, user, 'ops:tasks:read');
  const now = new Date();
  const [row] = await db
    .select(
      Object.fromEntries(HR_TASK_TABS.map((t) => [t.key, counted(tabCondition(t.query, now))])),
    )
    .from(tasks)
    .where(listWhere(access, { ...filters, groups: 'exclude' }));
  return row as Record<HrTaskTab, number>;
}

/** HR Overview: due today, overdue, blocked, awaiting approval, drafts not yet assigned. */
export async function hrTaskCounts(
  db: Database,
  user: Actor,
): Promise<{ key: string; label: string; value: number | null; href: string }[]> {
  if (!can(user, 'ops:tasks:read')) return [];
  const access = await taskAccess(db, user, 'ops:tasks:read');
  const now = new Date();
  const [c] = await db
    .select({
      dueToday: counted(
        and(
          eq(tasks.dueOn, istToday(now)),
          sql`${tasks.status} not in ('done', 'cancelled', 'draft')`,
        ),
      ),
      overdue: counted(dueFilter('overdue', now)),
      blocked: counted(listWhere(access, { flag: 'blocked' })),
      submitted: counted(eq(tasks.status, 'in_review')),
      drafts: counted(eq(tasks.status, 'draft')),
    })
    .from(tasks)
    .where(listWhere(access, { groups: 'exclude' }));
  return [
    {
      key: 'tasks_due_today',
      label: 'Tasks due today',
      value: c!.dueToday,
      href: `${TASKS}?due=today`,
    },
    {
      key: 'tasks_overdue',
      label: 'Overdue tasks',
      value: c!.overdue,
      href: `${TASKS}?tab=overdue`,
    },
    {
      key: 'tasks_blocked',
      label: 'Blocked tasks',
      value: c!.blocked,
      href: `${TASKS}?flag=blocked`,
    },
    {
      key: 'tasks_awaiting_approval',
      label: 'Submissions awaiting approval',
      value: c!.submitted,
      href: '/ops/hr/review',
    },
    {
      key: 'tasks_draft',
      label: 'Drafts not yet assigned',
      value: c!.drafts,
      href: `${TASKS}?status=draft`,
    },
  ];
}
