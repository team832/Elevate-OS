/**
 * Staff daily tasks (owner decision 21 Oct 2026; brief 2 §5–6): log work received by call,
 * WhatsApp or in person, update it through the day, list it. Own scope = your tasks and your
 * reports' (R3, task-store.ts); anything else answers 404. History = `ops.task_events` (+ audit).
 * Status changes follow the lifecycle (domain/task-lifecycle.ts); lifecycle actions, reassignment
 * and dependencies are in task-actions.ts. Completing a recurring task creates its next occurrence
 * once (unique `recurrence_parent_id`).
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
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  opsEodReports as eodReports,
  opsStaffTasks as tasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istToday, istWeekContaining, type IsoDate } from '../domain/dates';
import {
  buildEodSnapshot,
  nextOccurrence,
  resolveTaskState,
  type EodTask,
  type TaskStatus,
} from '../domain/staff-tasks';
import { actionForStatus, decide, GATE_ROLES } from '../domain/task-lifecycle';
import { accessScope, activeStaff, staffIdForUser, type Actor } from './context';
import { defined, fieldError, rowById } from './ops-common';
import type { TaskInput, TaskListQuery, TaskPatch } from './staff-tasks-schemas';
import {
  addDependencyRow,
  assertVersion,
  coversOwner,
  ctxOf,
  insertTaskWithEvent,
  loadTaskFor,
  refuse,
  taskAccess,
  writeTaskChange,
  type TaskAccess,
  type TaskEventInput,
  type TaskRow,
} from './task-store';

type Row = TaskRow;
export const TASK_PAGE_SIZE = 25;
const CLOSED: TaskStatus[] = ['done', 'cancelled'];
export const NO_STAFF_RECORD =
  'Your account is not linked to a staff record, so you have no tasks of your own. Staff records are linked in the Staff directory.';

/** The caller's own staff id, or FORBIDDEN with what to do. */
export async function ownStaffId(db: Database, actor: Actor): Promise<StaffMemberId> {
  const id = await staffIdForUser(db, actor.id);
  if (!id) throw new ForbiddenError(NO_STAFF_RECORD);
  return id;
}

const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

/** Tasks that belong in a day's view: not done and due by then, or completed that day. */
export async function dayTasks(db: Database, staffId: string, day: string): Promise<EodTask[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.staffId, staffId as StaffMemberId),
        or(
          and(notInArray(tasks.status, CLOSED), lte(tasks.dueOn, day)),
          and(
            gte(tasks.completedAt, istStart(day)),
            lt(tasks.completedAt, istStart(addDays(day as IsoDate, 1))),
          ),
        ),
      ),
    );
}

/**
 * "My day": the day's tasks grouped as in the EOD report. A reader with all scope may pick a
 * staff member; null when the caller has no staff record.
 */
export async function myDay(db: Database, actor: Actor, day: string, staffId?: string) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const owner = access.scope === 'all' && staffId ? staffId : await staffIdForUser(db, actor.id);
  if (!owner) return null;
  return buildEodSnapshot(await dayTasks(db, owner, day), day, new Date());
}

/** Own scope = task-store `canSee`: your and your reports' tasks (R3), and where you review, back up or assigned. */
function ownerFilter(a: TaskAccess, staffId?: string): SQL | undefined {
  const owner = staffId ? eq(tasks.staffId, staffId as StaffMemberId) : undefined;
  if (a.all) return owner;
  if (!a.self) return sql`false`;
  // `?staffId=` narrows what you may see; it never widens it (a reviewer still sees the owner's tasks they review).
  return and(
    owner,
    or(
      inArray(tasks.staffId, [a.self, ...a.managed] as StaffMemberId[]),
      eq(tasks.reviewerStaffId, a.self),
      eq(tasks.backupStaffId, a.self),
      eq(tasks.assignedByStaffId, a.self),
    ),
  );
}

/** Due filters in IST: overdue = open and due before today (or today past its time). */
function dueFilter(due: TaskListQuery['due'], now: Date): SQL | undefined {
  const today = istToday(now);
  const open = notInArray(tasks.status, CLOSED);
  if (due === 'today') return eq(tasks.dueOn, today);
  if (due === 'week') {
    const w = istWeekContaining(today);
    return and(gte(tasks.dueOn, w.from), lte(tasks.dueOn, w.to));
  }
  if (due === 'overdue') {
    const clock = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    return and(
      open,
      or(lt(tasks.dueOn, today), and(eq(tasks.dueOn, today), lte(tasks.dueTime, clock))),
    );
  }
  return undefined;
}

/**
 * Home-page figures for the caller's own tasks: open, overdue and due today (IST), and the status
 * of today's EOD report ('not_started' when there is none). Two aggregate queries, no lists; null
 * without a staff record.
 */
export async function taskDaySummary(db: Database, actor: Actor, now = new Date()) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const day = istToday(now);
  const where = (cond: SQL | undefined) =>
    sql<number>`count(*) filter (where ${cond})`.mapWith(Number);
  const [[c], [eod]] = await Promise.all([
    db
      .select({
        open: count(),
        overdue: where(dueFilter('overdue', now)),
        dueToday: where(eq(tasks.dueOn, day)),
      })
      .from(tasks)
      .where(and(eq(tasks.staffId, staffId), notInArray(tasks.status, CLOSED))),
    db
      .select({ status: eodReports.status })
      .from(eodReports)
      .where(and(eq(eodReports.staffId, staffId), eq(eodReports.reportDate, day)))
      .limit(1),
  ]);
  return { day, asOf: now, ...c!, eod: eod?.status ?? ('not_started' as const) };
}

/** All tasks the caller may read, newest due day first. */
export async function listTasks(
  db: Database,
  actor: Actor,
  q: TaskListQuery,
  pageSize = TASK_PAGE_SIZE,
) {
  const access = await taskAccess(db, actor, 'ops:tasks:read');
  const where = and(
    ownerFilter(access, q.staffId),
    q.q ? ilike(tasks.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.status ? eq(tasks.status, q.status) : undefined,
    q.priority ? eq(tasks.priority, q.priority) : undefined,
    q.departmentId ? eq(tasks.departmentId, q.departmentId as never) : undefined,
    q.from ? gte(tasks.dueOn, q.from) : undefined,
    q.to ? lte(tasks.dueOn, q.to) : undefined,
    dueFilter(q.due, new Date()),
    q.ack ? and(isNull(tasks.acknowledgedAt), notInArray(tasks.status, CLOSED)) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        progressPercent: tasks.progressPercent,
        reason: tasks.reason,
        dueOn: tasks.dueOn,
        dueTime: tasks.dueTime,
        recurrence: tasks.recurrence,
        acknowledgedAt: tasks.acknowledgedAt,
        isSample: tasks.isSample,
        staffName: staffMembers.fullName,
      })
      .from(tasks)
      .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
      .where(where)
      .orderBy(desc(tasks.dueOn), asc(tasks.dueTime), desc(tasks.createdAt))
      .limit(pageSize)
      .offset((q.page - 1) * pageSize),
    db.select({ n: count() }).from(tasks).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page: q.page, pageSize };
}

/** Staff fields that must name an active staff member when given. */
const STAFF_FIELDS = [
  'assignedByStaffId',
  'requesterStaffId',
  'backupStaffId',
  'reviewerStaffId',
] as const;

async function checkPeople(
  db: Database,
  owner: string,
  v: Partial<Record<(typeof STAFF_FIELDS)[number], string | null>>,
) {
  for (const f of STAFF_FIELDS) if (v[f]) await activeStaff(db, v[f], f);
  if (v.reviewerStaffId === owner)
    throw fieldError('reviewerStaffId', 'The reviewer must be someone other than the owner.');
  if (v.backupStaffId === owner)
    throw fieldError('backupStaffId', 'The backup must be someone other than the owner.');
}

/** Log a task: for yourself, a direct or indirect report (R3), or anyone with all-scope write. */
export async function createTask(db: Database, actor: Actor, input: TaskInput, requestId?: string) {
  const access = await taskAccess(db, actor, 'ops:tasks:write');
  const staffId = input.staffId ?? (await ownStaffId(db, actor));
  if (!coversOwner(access, staffId))
    throw new ForbiddenError(
      'You can assign tasks only to yourself and the people who report to you.',
    );
  await activeStaff(db, staffId);
  const forOther = staffId !== access.self;
  // Only all scope may record someone else as the assigner; otherwise it is you.
  const assignedByStaffId = (access.all && input.assignedByStaffId) || access.self;
  await checkPeople(db, staffId, { ...input, assignedByStaffId });
  const source =
    forOther && (input.source ?? 'self') === 'self' ? 'manager' : (input.source ?? 'self');
  const closedBy = (await ctxOf(db, [])).closedBy;
  const doneOk = !forOther && !input.reviewRequired && closedBy === 'owner' && source === 'self';
  if (['in_review', 'cancelled'].includes(input.status) || (input.status === 'done' && !doneOk))
    throw fieldError(
      'status',
      'Start a task as not started, in progress, blocked or on hold. Only work you log for yourself, without review, can start as done.',
    );
  const { state, error } = resolveTaskState(null, input);
  if (error) throw fieldError(error.field, error.message);
  const { dependsOn = [], ...values } = input;
  const now = new Date();
  return withTransaction(db, async (tx) => {
    const row = (await insertTaskWithEvent(
      tx,
      actor,
      {
        ...(values as Partial<typeof tasks.$inferInsert>),
        ...state,
        title: input.title,
        staffId: staffId as StaffMemberId,
        assignedByStaffId: assignedByStaffId as StaffMemberId | null,
        source,
        dueOn: input.dueOn ?? istToday(now),
        receivedAt: input.receivedAt ?? now,
        // Work you log for yourself is acknowledged by logging it; assigned work is not (§5).
        acknowledgedAt: forOther ? null : now,
        acknowledgedByUserId: forOther ? null : actor.id,
        completedAt: state.status === 'done' ? now : null,
        createdBy: actor.id,
      },
      { requestId },
    ))!;
    for (const dep of dependsOn) await addDependencyRow(tx, actor, access, row, dep);
    if (row.status === 'done') await createNext(tx, actor, row, requestId);
    return row;
  });
}

/** The next occurrence of a completed recurring task; at most one per task, so retries are safe. */
async function createNext(tx: Database, actor: Actor, done: Row, requestId?: string) {
  const prev =
    done.recurrence === 'monthly' && done.recurrenceParentId
      ? (await rowById(tx, tasks, done.recurrenceParentId, 'Task')).dueOn
      : null;
  const dueOn = nextOccurrence(done.dueOn, done.recurrence, prev);
  if (!dueOn) return null;
  const copied = [
    'staffId',
    'title',
    'details',
    'assignedByStaffId',
    'departmentId',
    'reviewerStaffId',
    'reviewRequired',
    'acceptanceCriteria',
    'leadId',
    'admissionId',
    'studentId',
    'priority',
    'dueTime',
    'recurrence',
    'isSample',
    'importBatchId',
  ] as const;
  return insertTaskWithEvent(
    tx,
    actor,
    {
      ...Object.fromEntries(copied.map((k) => [k, done[k]])),
      staffId: done.staffId,
      title: done.title,
      // R18: the occurrence keeps the parent's source and creator (recurrenceParentId marks it).
      source: done.source,
      dueOn,
      recurrenceParentId: done.id,
      createdBy: done.createdBy,
    },
    { audit: 'staff_task.recurred', data: { from: done.id }, requestId },
  );
}

/** After a change: completing a recurring task creates its next occurrence. */
export async function afterChange(
  tx: Database,
  actor: Actor,
  before: Row,
  after: Row,
  requestId?: string,
) {
  const completed = after.status === 'done' && before.status !== 'done';
  const next = completed ? await createNext(tx, actor, after, requestId) : null;
  return { ...after, nextTaskId: next?.id ?? null };
}

const sameValue = (k: string, a: unknown, b: unknown) =>
  k === 'dueTime'
    ? String(a ?? '').slice(0, 5) === String(b ?? '').slice(0, 5)
    : String(a ?? '') === String(b ?? '');

/**
 * Change a task's fields (owner, a manager up the chain, all scope). A status change goes through
 * the lifecycle; review and cancel only via their actions. One event per kind of change.
 */
export async function updateTask(
  db: Database,
  actor: Actor,
  id: string,
  patch: TaskPatch,
  requestId?: string,
) {
  const { expectedVersion, changeReason, ...fields } = patch;
  return withTransaction(db, async (tx) => {
    const { row: before, roles, life } = await loadTaskFor(tx, actor, id, true);
    if (!roles.some((r) => r !== 'reviewer'))
      throw new ForbiddenError('Only the owner or their manager can change this task.');
    assertVersion(before, expectedVersion);
    const set = Object.fromEntries(
      Object.entries(defined(fields)).filter(([k, v]) => !sameValue(k, before[k as keyof Row], v)),
    ) as Partial<Row>;
    const keys = Object.keys(set);
    if (!keys.length) return { ...before, nextTaskId: null };
    // R18: the review step belongs to whoever logged the task (or all scope), nobody else.
    if (
      ('reviewRequired' in set || 'reviewerStaffId' in set) &&
      !GATE_ROLES.some((r) => roles.includes(r))
    )
      throw new ForbiddenError('Only the person who logged this task can change its review step.');
    await checkPeople(tx, before.staffId, set);
    const events: TaskEventInput[] = [];
    if (set.status) {
      const map = actionForStatus(before.status, set.status, before.reviewRequired);
      if (map.error) throw fieldError('status', map.error);
      const d = decide(map.action!, life, await ctxOf(tx, roles), patch.reason);
      refuse(d);
      events.push({
        kind: d.event,
        fromStatus: before.status,
        toStatus: set.status,
        reason: patch.reason ?? null,
      });
    }
    const { state, error } = resolveTaskState(before, patch);
    if (error) throw fieldError(error.field, error.message);
    const after = { ...before, ...set };
    if ('dueOn' in set || 'dueTime' in set)
      events.push({
        kind: 'due_changed',
        reason: changeReason ?? null,
        data: {
          fromDueOn: before.dueOn,
          toDueOn: after.dueOn,
          fromDueTime: before.dueTime,
          toDueTime: after.dueTime,
        },
      });
    if (set.priority)
      events.push({
        kind: 'priority_changed',
        reason: changeReason ?? null,
        data: { from: before.priority, to: set.priority },
      });
    const edited = keys.filter((k) => !['status', 'dueOn', 'dueTime', 'priority'].includes(k));
    if (edited.length) events.push({ kind: 'edited', data: { edited } });
    const done = state.status === 'done';
    const saved = await writeTaskChange(
      tx,
      actor,
      before,
      { ...set, ...state, completedAt: done ? (before.completedAt ?? new Date()) : null },
      events,
      done && before.status !== 'done' ? 'staff_task.completed' : 'staff_task.updated',
      requestId,
    );
    return afterChange(tx, actor, before, saved, requestId);
  });
}
