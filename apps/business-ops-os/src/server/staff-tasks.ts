/**
 * Staff daily tasks (owner decision 21 Oct 2026): log work received by call, WhatsApp or in
 * person, update it through the day, list it. Own scope = tasks whose owner is the caller's staff
 * record; another person's task answers 404. History is the audit trail (before/after + reason).
 * Completing a recurring task creates its next occurrence once (unique `recurrence_parent_id`).
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
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { opsStaffTasks as tasks, staffMembers, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../domain/dates';
import {
  buildEodSnapshot,
  nextOccurrence,
  resolveTaskState,
  type EodTask,
} from '../domain/staff-tasks';
import {
  accessScope,
  activeStaff,
  assertScope,
  notFound,
  scopeCovers,
  staffIdForUser,
  type AccessScope,
  type Actor,
} from './context';
import { defined, fieldError, opsAudit, rowById } from './ops-common';
import type { TaskInput, TaskListQuery, TaskPatch } from './staff-tasks-schemas';

type Row = typeof tasks.$inferSelect;
const audit = opsAudit('staff_task');
export const TASK_PAGE_SIZE = 25;
export const NO_STAFF_RECORD =
  'Your account is not linked to a staff record, so you have no tasks of your own. Staff records are linked in the Staff directory.';

/** The caller's own staff id, or FORBIDDEN with what to do. */
export async function ownStaffId(db: Database, actor: Actor): Promise<StaffMemberId> {
  const id = await staffIdForUser(db, actor.id);
  if (!id) throw new ForbiddenError(NO_STAFF_RECORD);
  return id;
}

async function loadTask(db: Database, actor: Actor, id: string, write: boolean): Promise<Row> {
  const access = await accessScope(db, actor, write ? 'ops:tasks:write' : 'ops:tasks:read');
  const row = await rowById(db, tasks, id, 'Task', write);
  if (!scopeCovers(access, [row.staffId])) notFound('Task');
  return row;
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
          and(ne(tasks.status, 'done'), lte(tasks.dueOn, day)),
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

export async function getTask(db: Database, actor: Actor, id: string) {
  const row = await loadTask(db, actor, id, false);
  const names = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(inArray(staffMembers.id, [row.staffId, row.assignedByStaffId ?? row.staffId]));
  const name = (id: string | null) => names.find((n) => n.id === id)?.fullName ?? null;
  return { ...row, staffName: name(row.staffId), assignedByName: name(row.assignedByStaffId) };
}

function ownerFilter(access: AccessScope, staffId?: string): SQL | undefined {
  if (access.scope === 'own')
    return access.staffId ? eq(tasks.staffId, access.staffId) : sql`false`;
  return staffId ? eq(tasks.staffId, staffId as StaffMemberId) : undefined;
}

/** All tasks the caller may read, newest due day first (all scope may filter by staff). */
export async function listTasks(
  db: Database,
  actor: Actor,
  q: TaskListQuery,
  pageSize = TASK_PAGE_SIZE,
) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const where = and(
    ownerFilter(access, q.staffId),
    q.q ? ilike(tasks.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.status ? eq(tasks.status, q.status) : undefined,
    q.priority ? eq(tasks.priority, q.priority) : undefined,
    q.from ? gte(tasks.dueOn, q.from) : undefined,
    q.to ? lte(tasks.dueOn, q.to) : undefined,
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

/** Log a task (yours, or anyone's with all-scope write). */
export async function createTask(db: Database, actor: Actor, input: TaskInput, requestId?: string) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  const staffId = input.staffId ?? (await ownStaffId(db, actor));
  assertScope(access, [staffId], 'tasks');
  await activeStaff(db, staffId);
  if (input.assignedByStaffId) await activeStaff(db, input.assignedByStaffId, 'assignedByStaffId');
  const { state, error } = resolveTaskState(null, input);
  if (error) throw fieldError(error.field, error.message);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        ...(input as Partial<typeof tasks.$inferInsert>),
        ...state,
        title: input.title,
        staffId: staffId as StaffMemberId,
        dueOn: input.dueOn ?? istToday(new Date()),
        completedAt: state.status === 'done' ? new Date() : null,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, row!.id, 'staff_task.created', { after: row }, requestId);
    if (row!.status === 'done') await createNext(tx, actor, row!, requestId);
    return row!;
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
  const [next] = await tx
    .insert(tasks)
    .values({
      staffId: done.staffId,
      title: done.title,
      details: done.details,
      assignedByStaffId: done.assignedByStaffId,
      leadId: done.leadId,
      admissionId: done.admissionId,
      studentId: done.studentId,
      priority: done.priority,
      dueOn,
      dueTime: done.dueTime,
      recurrence: done.recurrence,
      recurrenceParentId: done.id,
      createdBy: actor.id,
    })
    .onConflictDoNothing()
    .returning();
  if (next)
    await audit(
      tx,
      actor,
      next.id,
      'staff_task.recurred',
      { after: next, metadata: { from: done.id } },
      requestId,
    );
  return next ?? null;
}

/** Change a task (status, progress, reason, details). Returns the task and any next occurrence. */
export async function updateTask(
  db: Database,
  actor: Actor,
  id: string,
  patch: TaskPatch,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const before = await loadTask(tx, actor, id, true);
    if (patch.assignedByStaffId)
      await activeStaff(tx, patch.assignedByStaffId, 'assignedByStaffId');
    const { state, error } = resolveTaskState(before, patch);
    if (error) throw fieldError(error.field, error.message);
    const [after] = await tx
      .update(tasks)
      .set({
        ...(defined(patch) as Partial<Row>),
        ...state,
        completedAt: state.status === 'done' ? (before.completedAt ?? new Date()) : null,
        updatedBy: actor.id,
      })
      .where(eq(tasks.id, before.id))
      .returning();
    const completed = after!.status === 'done' && before.status !== 'done';
    await audit(
      tx,
      actor,
      id,
      completed ? 'staff_task.completed' : 'staff_task.updated',
      { before, after, metadata: { reason: after!.reason } },
      requestId,
    );
    const next = completed ? await createNext(tx, actor, after!, requestId) : null;
    return { ...after!, nextTaskId: next?.id ?? null };
  });
}
