/**
 * Task lists (brief 2 §5; owner brief 23 Oct 2026 §9, §18): the list query shared by the
 * tracker, My Tasks, HR's task pages and the review queue, and its due / overdue conditions
 * (R5) in SQL. Scope = task-store `visibleFilter`.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { opsStaffTasks as tasks, staffMembers, type Database } from '@elevate/database';
import { addDays, istToday, istWeekContaining } from '../domain/dates';
import { WORK_STATUSES, type TaskStatus } from '../domain/staff-tasks';
import type { StaffMemberId } from '@elevate/shared-types';
import type { Actor } from './context';
import type { TaskListQuery } from './staff-tasks-schemas';
import { taskAccess, visibleFilter, type TaskAccess } from './task-store';

export const TASK_PAGE_SIZE = 25;
const CLOSED: TaskStatus[] = ['done', 'cancelled'];

/** A parent of a multi-assignment: a container whose children carry the work (brief §8). */
export const isGroup = sql`exists (select 1 from ops.staff_tasks c where c.parent_task_id = ${tasks.id})`;

const clockNow = (now: Date) =>
  now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });

/** R5 in SQL: work still with the assignee and past its deadline (IST; no time = end of day). */
export const overdueSql = (now: Date) => {
  const today = istToday(now);
  return and(
    inArray(tasks.status, WORK_STATUSES as TaskStatus[]),
    or(
      lt(tasks.dueOn, today),
      and(
        eq(tasks.dueOn, today),
        // Late from the minute after the deadline (domain deadlineInstant).
        sql`coalesce(${tasks.dueTime}, '23:59:00'::time) < ${clockNow(now).slice(0, 5)}::time`,
      ),
    ),
  );
};

/** Due filters in IST; `soon` = open work due today or in the next two days and not yet overdue. */
export function dueFilter(due: TaskListQuery['due'], now: Date): SQL | undefined {
  const today = istToday(now);
  if (due === 'today') return eq(tasks.dueOn, today);
  if (due === 'week') {
    const w = istWeekContaining(today);
    return and(gte(tasks.dueOn, w.from), lte(tasks.dueOn, w.to));
  }
  if (due === 'overdue') return overdueSql(now);
  if (due === 'soon')
    return and(
      inArray(tasks.status, WORK_STATUSES as TaskStatus[]),
      gte(tasks.dueOn, today),
      lte(tasks.dueOn, addDays(today, 2)),
      sql`not (${overdueSql(now)})`,
    );
  return undefined;
}

/** The list's WHERE without its tab (HR tab counts reuse it with each tab's condition). */
export function listWhere(access: TaskAccess, q: Partial<TaskListQuery>) {
  return and(
    visibleFilter(access, q.staffId),
    q.q ? ilike(tasks.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.priority ? eq(tasks.priority, q.priority) : undefined,
    q.departmentId ? eq(tasks.departmentId, q.departmentId as never) : undefined,
    q.from ? gte(tasks.dueOn, q.from) : undefined,
    q.to ? lte(tasks.dueOn, q.to) : undefined,
    q.ack
      ? and(isNull(tasks.acknowledgedAt), notInArray(tasks.status, [...CLOSED, 'draft']))
      : undefined,
    q.flag
      ? and(isNotNull(tasks.blockedAt), inArray(tasks.status, WORK_STATUSES as TaskStatus[]))
      : undefined,
    q.groups ? sql`not ${isGroup}` : undefined,
    q.open ? notInArray(tasks.status, [...CLOSED, 'draft']) : undefined,
    q.reviewable ? reviewableBy(access) : undefined,
  );
}

/** The user who handed in the task's latest version (null before any). */
const lastSubmitter = sql`(select s.submitted_by_user_id from ops.task_submissions s where s.task_id = ${tasks.id} order by s.version desc limit 1)`;

/**
 * Tasks this reader may decide on (M4): never their own; named reviewer, or ops:tasks:review
 * covering the owner (all scope within HR's departments, own scope = their reports). Department
 * or collaborator visibility alone does not make anyone a reviewer, and nobody decides a version
 * they handed in for someone else.
 */
function reviewableBy(a: TaskAccess) {
  const notMine = a.self ? sql`${tasks.staffId} <> ${a.self}` : undefined;
  const reports = [
    ...(a.review === 'all' ? (a.scopeStaff ?? []) : a.review === 'own' ? a.managed : []),
  ];
  const covered =
    a.review === 'all' && !a.scopeStaff
      ? sql`true`
      : reports.length
        ? inArray(tasks.staffId, reports as StaffMemberId[])
        : undefined;
  return and(
    notMine,
    sql`${lastSubmitter} is distinct from ${a.userId}`,
    or(a.self ? eq(tasks.reviewerStaffId, a.self) : undefined, covered) ?? sql`false`,
  );
}

const latest = (col: 'note' | 'decision') =>
  sql<
    string | null
  >`(select r.${sql.raw(col)} from ops.task_reviews r where r.task_id = ${tasks.id} and r.note is not null order by r.created_at desc limit 1)`;

/** All tasks the caller may read (newest due day first; the review queue oldest submission first). */
export async function listTasks(
  db: Database,
  actor: Actor,
  q: TaskListQuery,
  pageSize = TASK_PAGE_SIZE,
) {
  const access = await taskAccess(db, actor, 'ops:tasks:read');
  const now = new Date();
  const where = and(
    listWhere(access, q),
    q.status ? eq(tasks.status, q.status) : undefined,
    dueFilter(q.due, now),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        category: tasks.category,
        expectedDeliverable: tasks.expectedDeliverable,
        priority: tasks.priority,
        status: tasks.status,
        version: tasks.version,
        staffId: tasks.staffId,
        reviewRequired: tasks.reviewRequired,
        progressPercent: tasks.progressPercent,
        reason: tasks.reason,
        dueOn: tasks.dueOn,
        dueTime: tasks.dueTime,
        originalDueOn: tasks.originalDueOn,
        recurrence: tasks.recurrence,
        acknowledgedAt: tasks.acknowledgedAt,
        deliveredAt: tasks.deliveredAt,
        blockedAt: tasks.blockedAt,
        blockedKind: tasks.blockedKind,
        blockedReason: tasks.blockedReason,
        firstSubmittedAt: tasks.firstSubmittedAt,
        lastSubmittedAt: tasks.lastSubmittedAt,
        approvedAt: tasks.approvedAt,
        parentTaskId: tasks.parentTaskId,
        isSample: tasks.isSample,
        staffName: staffMembers.fullName,
        latestNote: latest('note'),
        latestDecision: latest('decision'),
        children:
          sql<number>`(select count(*) from ops.staff_tasks c where c.parent_task_id = ${tasks.id})`.mapWith(
            Number,
          ),
        /** Who handed in the latest version (the submitting user, M4). */
        submittedBy: sql<
          string | null
        >`(select u.display_name from core.users u where u.id = ${lastSubmitter})`,
        childrenDone:
          sql<number>`(select count(*) from ops.staff_tasks c where c.parent_task_id = ${tasks.id} and c.status = 'done')`.mapWith(
            Number,
          ),
      })
      .from(tasks)
      .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
      .where(where)
      .orderBy(
        ...(q.sort === 'submitted'
          ? [asc(tasks.lastSubmittedAt)]
          : [desc(tasks.dueOn), asc(tasks.dueTime), desc(tasks.createdAt)]),
      )
      .limit(pageSize)
      .offset((q.page - 1) * pageSize),
    db.select({ n: count() }).from(tasks).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page: q.page, pageSize };
}
export type TaskListRow = Awaited<ReturnType<typeof listTasks>>['rows'][number];
