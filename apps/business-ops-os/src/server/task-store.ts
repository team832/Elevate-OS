/**
 * Task scope and writes shared by the task services and the tracker import (O4). Own scope =
 * your tasks plus those of your direct and indirect reports (R3), and tasks where you are the
 * reviewer, backup or assigner (naming a requester grants nothing: anyone can name anyone). Every write bumps `version` and appends
 * `ops.task_events` plus an audit row in the caller's transaction.
 */
import { eq, sql } from 'drizzle-orm';
import type { Permission } from '@elevate/authorization';
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
import type { StaffMemberId } from '@elevate/shared-types';
import {
  createsCycle,
  isSelfLogged,
  REASSIGN_ROLES,
  type ActionContext,
  type Decision,
  type LifecycleTask,
  type TaskRole,
} from '../domain/task-lifecycle';
import { accessScope, managedStaffIds, notFound, staffIdForUser, type Actor } from './context';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventInput = Omit<typeof opsTaskEvents.$inferInsert, 'taskId' | 'actorUserId'>;
export const taskAudit = opsAudit('staff_task');

export interface TaskAccess {
  userId: string;
  all: boolean;
  self: StaffMemberId | null;
  /** Direct and indirect reports of `self`. */
  managed: ReadonlySet<string>;
}

export async function taskAccess(
  db: Database,
  actor: Actor,
  permission: Permission,
): Promise<TaskAccess> {
  const access = await accessScope(db, actor, permission);
  if (access.scope === 'all')
    return {
      userId: actor.id,
      all: true,
      self: await staffIdForUser(db, actor.id),
      managed: new Set(),
    };
  const managed = access.staffId ? await managedStaffIds(db, access.staffId) : [];
  return { userId: actor.id, all: false, self: access.staffId, managed: new Set(managed) };
}

/** Staff whose tasks this access may assign and own-scope list: yourself and your reports. */
export const coversOwner = (a: TaskAccess, staffId: string | null | undefined) =>
  a.all || (!!staffId && (staffId === a.self || a.managed.has(staffId)));

export function rolesOn(a: TaskAccess, t: TaskRow): TaskRole[] {
  const roles: TaskRole[] = [];
  if (a.self && t.staffId === a.self) roles.push('owner');
  if (a.managed.has(t.staffId)) roles.push('manager');
  if (a.all) roles.push('admin');
  if (a.self && t.reviewerStaffId === a.self) roles.push('reviewer');
  if (t.createdBy === a.userId) roles.push('creator');
  return roles;
}

/** One read rule for list, detail, report and writes. */
export const canSee = (
  a: TaskAccess,
  t: Pick<TaskRow, 'staffId' | 'reviewerStaffId' | 'backupStaffId' | 'assignedByStaffId'>,
) =>
  coversOwner(a, t.staffId) ||
  (!!a.self && [t.reviewerStaffId, t.backupStaffId, t.assignedByStaffId].includes(a.self));

/** The task (locked when `write`), the caller's access and roles; 404 outside read scope. */
export async function loadTaskFor(db: Database, actor: Actor, id: string, write: boolean) {
  const access = await taskAccess(db, actor, write ? 'ops:tasks:write' : 'ops:tasks:read');
  const row = await rowById(db, tasks, id, 'Task', write);
  if (!canSee(access, row)) notFound('Task');
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
    roles: rolesOn(access, row),
    life: lifecycleOf(row, owner?.userId ?? null, batch?.staffId ?? null),
  };
}

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

/**
 * Insert a task with its `created` (or `imported`) event, plus `acknowledged` when the values
 * carry an acknowledgement. Unique conflicts (recurrence parent, legacy ref) insert nothing and
 * return null, so retries and re-imports are safe. `occurredAt` keeps an original time (imports).
 */
export async function insertTaskWithEvent(
  tx: Database,
  actor: Actor,
  values: typeof tasks.$inferInsert,
  opts: {
    kind?: 'created' | 'imported';
    occurredAt?: Date;
    data?: Record<string, unknown>;
    audit?: string;
    requestId?: string;
  } = {},
): Promise<TaskRow | null> {
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
  selfLogged: isSelfLogged(t, ownerUserId, importStaffId),
});

/** R18: the creator, a manager of the owner, all scope, or the owner of self-logged work may hand it over. */
export const mayReassign = (roles: readonly TaskRole[], life: LifecycleTask) =>
  REASSIGN_ROLES.some((r) => roles.includes(r)) || (life.selfLogged && roles.includes('owner'));

/** Roles plus the setting tasks.completion_without_reviewer (proposed). */
export const ctxOf = async (db: Database, roles: TaskRole[]): Promise<ActionContext> => ({
  roles,
  closedBy: (await loadSettings(db))['tasks.completion_without_reviewer'].value.closedBy,
});

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
