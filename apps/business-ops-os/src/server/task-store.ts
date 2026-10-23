/**
 * Task scope and writes shared by the task services and the tracker import (O4). Own scope =
 * your tasks plus those of your direct and indirect reports (R3), and tasks where you are the
 * reviewer, backup or assigner (naming a requester grants nothing: anyone can name anyone).
 * Brief 23 Oct 2026: an HR manager's all scope covers only the staff of the departments in
 * `hr.staff_scope_departments`; a draft is hidden from its assignee until it is assigned; a task
 * shared with its department or named collaborators is readable by them. Every write bumps
 * `version` and appends `ops.task_events` plus an audit row in the caller's transaction.
 */
import { eq, sql } from 'drizzle-orm';
import {
  opsStaffTasks as tasks,
  opsTaskDependencies,
  opsTaskEvents,
  opsTaskImportBatches,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import {
  createsCycle,
  isSelfLogged,
  REASSIGN_ROLES,
  type ActionContext,
  type Decision,
  type LifecycleTask,
  type TaskRole,
} from '../domain/task-lifecycle';
import { notFound, type Actor } from './context';
import { canSee, isCollaborator, rolesOn, taskAccess, type TaskAccess } from './task-access';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export {
  canSee,
  coversOwner,
  hrScopeStaff,
  rolesOn,
  taskAccess,
  visibleFilter,
  type TaskAccess,
} from './task-access';

export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventInput = Omit<typeof opsTaskEvents.$inferInsert, 'taskId' | 'actorUserId'>;
export const taskAudit = opsAudit('staff_task');

/** The task (locked when `write`), the caller's access and roles; 404 outside read scope. */
export async function loadTaskFor(db: Database, actor: Actor, id: string, write: boolean) {
  const access = await taskAccess(db, actor, write ? 'ops:tasks:write' : 'ops:tasks:read');
  const row = await rowById(db, tasks, id, 'Task', write);
  const collaborator = await isCollaborator(db, access, row);
  if (!canSee(access, row, collaborator)) notFound('Task');
  const [owner] = await db
    .select({ userId: staffMembers.userId })
    .from(staffMembers)
    .where(eq(staffMembers.id, row.staffId));
  const [batch] = row.importBatchId
    ? await db
        .select({ staffId: opsTaskImportBatches.staffId })
        .from(opsTaskImportBatches)
        .where(eq(opsTaskImportBatches.id, row.importBatchId as never))
    : [];
  return {
    row,
    access,
    roles: [...rolesOn(access, row), ...(collaborator ? (['collaborator'] as const) : [])],
    life: lifecycleOf(row, owner?.userId ?? null, batch?.staffId ?? null),
    ownerUserId: owner?.userId ?? null,
  };
}

/** Edits, dependencies and work: any role but a mere reviewer or collaborator (they read and comment). */
export const editsTask = (roles: readonly TaskRole[]) =>
  roles.some((r) => r !== 'reviewer' && r !== 'collaborator');

/** Who may log work (updates, deliverables) on a loaded task: an editor, or the backup. */
export const mayLogWork = (t: { roles: readonly TaskRole[]; row: TaskRow; access: TaskAccess }) =>
  editsTask(t.roles) || (!!t.access.self && t.row.backupStaffId === t.access.self);

export function assertVersion(row: TaskRow, expected: number | undefined) {
  if (expected !== undefined && expected !== row.version)
    throw new ConflictError(
      'Someone changed this task after you opened it. Reload to see the latest.',
    );
}

/** Update the task (version + 1), append its events and one audit row. */
export async function writeTaskChange(
  tx: Database,
  actor: Actor,
  before: TaskRow,
  set: Partial<TaskRow>,
  events: TaskEventInput[],
  action: string,
  requestId?: string,
): Promise<TaskRow> {
  const [after] = await tx
    .update(tasks)
    .set({ ...set, version: before.version + 1, updatedBy: actor.id })
    .where(eq(tasks.id, before.id))
    .returning();
  for (const e of events)
    await tx.insert(opsTaskEvents).values({ ...e, taskId: before.id, actorUserId: actor.id });
  await taskAudit(tx, actor, before.id, action, { before, after }, requestId);
  return after!;
}

export type NewTask = Omit<typeof tasks.$inferInsert, 'originalDueOn'> & { originalDueOn?: string };

/**
 * Insert a task with its `created` (or `imported`) event, plus `acknowledged` when the values
 * carry an acknowledgement. The original deadline defaults to the due date (brief §10: kept
 * forever). Unique conflicts (recurrence parent, legacy ref) insert nothing and return null, so
 * retries and re-imports are safe. `occurredAt` keeps an original time (imports).
 */
export async function insertTaskWithEvent(
  tx: Database,
  actor: Actor,
  input: NewTask,
  opts: {
    kind?: 'created' | 'imported';
    occurredAt?: Date;
    data?: Record<string, unknown>;
    audit?: string;
    requestId?: string;
  } = {},
): Promise<TaskRow | null> {
  const values = { originalDueOn: input.dueOn, originalDueTime: input.dueTime ?? null, ...input };
  const [row] = await tx.insert(tasks).values(values).onConflictDoNothing().returning();
  if (!row) return null;
  const kind = opts.kind ?? 'created';
  const base = {
    taskId: row.id,
    actorUserId: actor.id,
    occurredAt: opts.occurredAt ?? row.receivedAt,
  };
  await tx.insert(opsTaskEvents).values({
    ...base,
    kind,
    toStatus: row.status,
    toStaffId: row.staffId,
    data: opts.data,
  });
  if (row.acknowledgedAt)
    await tx
      .insert(opsTaskEvents)
      .values({ ...base, kind: 'acknowledged', occurredAt: row.acknowledgedAt });
  if (row.blockedAt)
    await tx.insert(opsTaskEvents).values({
      ...base,
      kind: 'blocked_set',
      reason: row.blockedReason,
      data: { kind: row.blockedKind },
    });
  await taskAudit(
    tx,
    actor,
    row.id,
    opts.audit ?? `staff_task.${kind}`,
    { after: row },
    opts.requestId,
  );
  return row;
}

/** The lifecycle view of a task row; `ownerUserId` = the owner's login (R18 self-logged). */
export const lifecycleOf = (
  t: TaskRow,
  ownerUserId: string | null,
  importStaffId: string | null = null,
): LifecycleTask => ({
  status: t.status,
  reviewRequired: t.reviewRequired,
  acknowledged: Boolean(t.acknowledgedAt),
  blocked: Boolean(t.blockedAt),
  selfLogged: isSelfLogged(t, ownerUserId, importStaffId),
});

/** R18: the creator, a manager of the owner, all scope, or the owner of self-logged work may hand it over. */
export const mayReassign = (roles: readonly TaskRole[], life: LifecycleTask) =>
  REASSIGN_ROLES.some((r) => roles.includes(r)) || (life.selfLogged && roles.includes('owner'));

/**
 * Roles plus the settings tasks.completion_without_reviewer and tasks.reopen_roles (proposed):
 * the named reviewer, the owner's line manager, or a holder of a listed role key who covers the
 * task may reopen an approved task.
 */
export async function ctxOf(
  db: Database,
  roles: TaskRole[],
  actor?: Actor,
): Promise<ActionContext> {
  const s = await loadSettings(db);
  const who: readonly string[] = s['tasks.reopen_roles'].value.who;
  const covers = roles.includes('admin') || roles.includes('reviewer');
  return {
    roles,
    closedBy: s['tasks.completion_without_reviewer'].value.closedBy,
    mayReopenApproved:
      (who.includes('reviewer') && roles.includes('reviewer')) ||
      (who.includes('line_manager') && roles.includes('manager')) ||
      (covers && !!actor?.roles.some((r) => who.includes(r))),
  };
}

/** Throw the error a refused lifecycle decision stands for (403, 400 on `reason`, 409). */
export function refuse(d: Decision): asserts d is Extract<Decision, { ok: true }> {
  if (d.ok) return;
  if (d.code === 'forbidden') throw new ForbiddenError(d.message);
  if (d.code === 'reason') throw fieldError('reason', d.message);
  throw new InvalidStateTransitionError(d.message);
}

/** Serialise dependency writes (re-entrant within the transaction). */
export const lockDependencies = (tx: Database) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops.task_dependencies'))`);

/**
 * Link `task` to wait on `dependsOn`: a task you can see, not itself, closing no loop (A-TSK-6).
 * The advisory lock serialises dependency writes so two requests cannot each close half a loop.
 */
export async function addDependencyRow(
  tx: Database,
  actor: Actor,
  access: TaskAccess,
  task: TaskRow,
  dependsOn: string,
): Promise<TaskRow> {
  const fail = (m: string) => fieldError('dependsOnTaskId', m);
  if (dependsOn === task.id) throw fail('A task cannot wait on itself.');
  const [dep] = await tx
    .select()
    .from(tasks)
    .where(eq(tasks.id, dependsOn as never))
    .limit(1);
  if (!dep || !canSee(access, dep)) throw fail('Pick a task you can see.');
  await lockDependencies(tx);
  // shortcut: reads every dependency edge (tens to hundreds); use a recursive CTE if it grows.
  const edges = await tx
    .select({ a: opsTaskDependencies.taskId, b: opsTaskDependencies.dependsOnTaskId })
    .from(opsTaskDependencies);
  if (
    createsCycle(
      edges.map((e) => [e.a, e.b] as const),
      task.id,
      dep.id,
    )
  )
    throw fail('That task already waits on this one, so they would wait on each other.');
  await tx
    .insert(opsTaskDependencies)
    .values({ taskId: task.id, dependsOnTaskId: dep.id, createdByUserId: actor.id });
  return dep;
}
