/**
 * Staff tasks (owner decision 21 Oct 2026; brief 2 §5–6; brief 23 Oct 2026 §8–§10): list, day
 * view and edits. Read scope = task-store `canSee` / `visibleFilter`; anything else answers 404.
 * History = `ops.task_events` (+ audit). Creating (incl. HR multi-assign) is in task-create.ts;
 * lifecycle actions, reassignment and dependencies in task-actions.ts; submission and review in
 * task-submissions.ts. Completing a recurring task creates its next occurrence once (unique
 * `recurrence_parent_id`).
 */
import { and, eq, gte, inArray, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  opsEodReports as eodReports,
  opsStaffTasks as tasks,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../domain/dates';
import {
  buildEodSnapshot,
  nextOccurrence,
  WORK_STATUSES,
  resolveTaskState,
  type EodTask,
  type TaskStatus,
} from '../domain/staff-tasks';
import { BRIEF_ROLES, GATE_ROLES } from '../domain/task-lifecycle';
import { accessScope, activeStaff, staffIdForUser, type Actor } from './context';
import { defined, fieldError, rowById } from './ops-common';
import type { TaskPatch } from './staff-tasks-schemas';
import { isGroup, overdueSql } from './task-list';
import {
  assertVersion,
  editsTask,
  insertTaskWithEvent,
  loadTaskFor,
  writeTaskChange,
  type TaskEventInput,
  type TaskRow,
} from './task-store';

export { createTask } from './task-create';
export {
  dueFilter,
  isGroup,
  listTasks,
  listWhere,
  overdueSql,
  TASK_PAGE_SIZE,
  type TaskListRow,
} from './task-list';

type Row = TaskRow;
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

/** Tasks that belong in a day's view: open work due by then, or completed that day (no drafts or groups). */
export async function dayTasks(db: Database, staffId: string, day: string): Promise<EodTask[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.staffId, staffId as StaffMemberId),
        sql`not ${isGroup}`,
        or(
          and(notInArray(tasks.status, [...CLOSED, 'draft']), lte(tasks.dueOn, day)),
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

/**
 * Home-page figures for the caller's own tasks: open (still with them, as teacher-ops taskFacts),
 * overdue, due today (IST), submitted and waiting for review, and the status
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
        open: where(inArray(tasks.status, WORK_STATUSES as TaskStatus[])),
        overdue: where(overdueSql(now)),
        dueToday: where(eq(tasks.dueOn, day)),
        /** Submitted, waiting for review (ACAD My Day "Work awaiting HR review"). */
        submitted: where(eq(tasks.status, 'in_review')),
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.staffId, staffId),
          notInArray(tasks.status, [...CLOSED, 'draft']),
          sql`not ${isGroup}`,
        ),
      ),
    db
      .select({ status: eodReports.status })
      .from(eodReports)
      .where(
        and(
          eq(eodReports.staffId, staffId),
          eq(eodReports.periodKind, 'day'),
          eq(eodReports.periodStart, day),
        ),
      )
      .limit(1),
  ]);
  return { day, asOf: now, ...c!, eod: eod?.status ?? ('not_started' as const) };
}

/** Staff fields that must name an active staff member when given. */
const STAFF_FIELDS = [
  'assignedByStaffId',
  'requesterStaffId',
  'backupStaffId',
  'reviewerStaffId',
] as const;

type People = Partial<Record<(typeof STAFF_FIELDS)[number], string | null>>;

/** Given people are active; the reviewer is independent of the owner side (N2); `current` = the task's. */
export async function checkPeople(db: Database, owner: string, v: People, current: People = {}) {
  for (const f of STAFF_FIELDS) if (v[f]) await activeStaff(db, v[f], f);
  const p = { ...current, ...v };
  if (p.reviewerStaffId && [owner, p.backupStaffId].includes(p.reviewerStaffId))
    throw fieldError(
      v.reviewerStaffId ? 'reviewerStaffId' : 'backupStaffId',
      'The reviewer must be someone other than the owner and the backup.',
    );
  if (p.backupStaffId === owner)
    throw fieldError('backupStaffId', 'The backup must be someone other than the owner.');
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
    'category',
    'expectedDeliverable',
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

/** The brief of assigned work: set by whoever assigns it (BRIEF_ROLES), asked about by the assignee. */
const BRIEF_FIELDS = new Set([
  'title',
  'details',
  'expectedDeliverable',
  'acceptanceCriteria',
  'category',
  'linkedRef',
  'reviewerStaffId',
  'dueOn',
  'dueTime',
]);

/**
 * Change a task's fields (owner, a manager up the chain, all scope). Never its status: every
 * status change goes through the task actions (task-actions.ts), the one gate for review rows,
 * approval and notifications. On assigned work the brief and deadline are the assigner's; on
 * self-logged work the owner's. A deadline change needs a reason and keeps the original deadline
 * (a draft's deadline is still its original). One event per kind of change.
 */
export async function updateTask(
  db: Database,
  actor: Actor,
  id: string,
  patch: TaskPatch,
  requestId?: string,
) {
  const { expectedVersion, changeReason, ...fields } = patch;
  if (fields.status !== undefined)
    throw fieldError(
      'status',
      'Use the task actions (start, submit, approve, cancel…) to change its status.',
    );
  return withTransaction(db, async (tx) => {
    const { row: before, roles, life } = await loadTaskFor(tx, actor, id, true);
    if (!editsTask(roles))
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
    if (set.reviewRequired === false && roles.includes('owner'))
      throw new ForbiddenError('You cannot turn off the review of your own task.');
    if (
      !life.selfLogged &&
      keys.some((k) => BRIEF_FIELDS.has(k)) &&
      !BRIEF_ROLES.some((r) => roles.includes(r))
    )
      throw new ForbiddenError(
        'Whoever assigned this task sets its brief and deadline. Ask for clarification instead.',
      );
    await checkPeople(tx, before.staffId, set, before);
    const events: TaskEventInput[] = [];
    const { state, error } = resolveTaskState(before, patch);
    if (error) throw fieldError(error.field, error.message);
    const after = { ...before, ...set };
    const dueMoved = 'dueOn' in set || 'dueTime' in set;
    if (dueMoved && before.status === 'draft')
      Object.assign(set, { originalDueOn: after.dueOn, originalDueTime: after.dueTime });
    else if (dueMoved) {
      if (!changeReason)
        throw fieldError(
          'changeReason',
          'Say why the deadline changed (it is kept in the history).',
        );
      events.push({
        kind: 'due_changed',
        reason: changeReason,
        data: {
          fromDueOn: before.dueOn,
          toDueOn: after.dueOn,
          fromDueTime: before.dueTime,
          toDueTime: after.dueTime,
        },
      });
    }
    if (set.priority)
      events.push({
        kind: 'priority_changed',
        reason: changeReason ?? null,
        data: { from: before.priority, to: set.priority },
      });
    const edited = keys.filter((k) => !['dueOn', 'dueTime', 'priority'].includes(k));
    if (edited.length) events.push({ kind: 'edited', data: { edited } });
    const saved = await writeTaskChange(
      tx,
      actor,
      before,
      { ...set, ...state },
      events,
      'staff_task.updated',
      requestId,
    );
    return { ...saved, nextTaskId: null };
  });
}
