/**
 * Task lifecycle actions, reassignment and dependencies (brief 2 §5–6, A-TSK-5/6). Each is one
 * transaction: lock, check `expectedVersion`, decide, write the task, its event and an audit row.
 * Warnings (open dependencies) are returned, never enforced: finishing B never completes A.
 */
import { and, eq, inArray, notInArray, or } from 'drizzle-orm';
import {
  opsStaffTasks as tasks,
  opsTaskDependencies as deps,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { resolveTaskState } from '../domain/staff-tasks';
import { decide, isOpenStatus, type TaskAction } from '../domain/task-lifecycle';
import { activeStaff, type Actor } from './context';
import { fieldError } from './ops-common';
import { afterChange } from './staff-tasks';
import type { TaskActionBody } from './staff-tasks-schemas';
import {
  addDependencyRow,
  assertVersion,
  canSee,
  coversOwner,
  ctxOf,
  loadTaskFor,
  lockDependencies,
  mayReassign,
  refuse,
  writeTaskChange,
  type TaskAccess,
} from './task-store';

const HIDDEN = 'A task you can’t see';

/** Titles of the open tasks this one waits on (tasks outside the reader's scope stay unnamed). */
export async function waitingOn(db: Database, access: TaskAccess, taskId: string) {
  const rows = await db
    .select({ task: tasks })
    .from(deps)
    .innerJoin(tasks, eq(tasks.id, deps.dependsOnTaskId))
    .where(and(eq(deps.taskId, taskId as never), notInArray(tasks.status, ['done', 'cancelled'])));
  return rows.map(({ task }) => (canSee(access, task) ? task.title : HIDDEN));
}

const WARN_ON: readonly TaskAction[] = ['start', 'submit', 'complete', 'approve'];

export async function taskAction(
  db: Database,
  actor: Actor,
  id: string,
  action: TaskAction,
  body: TaskActionBody,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { row: before, roles, life, access } = await loadTaskFor(tx, actor, id, true);
    assertVersion(before, body.expectedVersion);
    const d = decide(action, life, await ctxOf(tx, roles), body.reason);
    refuse(d);
    const status = d.to ?? before.status;
    const { state } = resolveTaskState(before, {
      status,
      reason: d.to && ['blocked', 'on_hold', 'cancelled'].includes(d.to) ? body.reason : undefined,
    });
    const now = new Date();
    const after = await writeTaskChange(
      tx,
      actor,
      before,
      {
        ...state,
        completedAt: status === 'done' ? (before.completedAt ?? now) : null,
        ...(action === 'acknowledge'
          ? { acknowledgedAt: now, acknowledgedByUserId: actor.id }
          : {}),
      },
      [
        {
          kind: d.event,
          fromStatus: d.to ? before.status : null,
          toStatus: d.to,
          reason: body.reason ?? null,
        },
      ],
      `staff_task.${action}`,
      requestId,
    );
    const waits = WARN_ON.includes(action) ? await waitingOn(tx, access, id) : [];
    return {
      ...(await afterChange(tx, actor, before, after, requestId)),
      warnings: waits.map((t) => `Waiting on “${t}”.`),
    };
  });
}

/**
 * Hand the task to a new accountable owner within your scope (yourself or your reports; all
 * scope: anyone). The `reassigned` event keeps the ownership history; the new owner has to
 * acknowledge (unless they reassign it to themselves).
 */
export async function reassignTask(
  db: Database,
  actor: Actor,
  id: string,
  body: { expectedVersion: number; toStaffId: string; reason?: string | null },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { row: before, roles, access, life } = await loadTaskFor(tx, actor, id, true);
    // R18: the owner of assigned work can only ask; the creator, the owner's manager or all scope hand it over.
    if (!mayReassign(roles, life))
      throw new ForbiddenError('Ask whoever gave you this to hand it over.');
    if (!coversOwner(access, body.toStaffId))
      throw new ForbiddenError(
        'You can hand work only to yourself or the people who report to you.',
      );
    assertVersion(before, body.expectedVersion);
    if (!isOpenStatus(before.status))
      throw new InvalidStateTransitionError('Reopen the task before handing it over.');
    if (body.toStaffId === before.staffId) throw fieldError('toStaffId', 'Already the owner.');
    if (body.toStaffId === before.reviewerStaffId)
      throw fieldError('toStaffId', 'The reviewer cannot also own the task.');
    await activeStaff(tx, body.toStaffId, 'toStaffId');
    const self = body.toStaffId === access.self;
    const now = new Date();
    const after = await writeTaskChange(
      tx,
      actor,
      before,
      {
        staffId: body.toStaffId as StaffMemberId,
        backupStaffId: before.backupStaffId === body.toStaffId ? null : before.backupStaffId,
        // Handing work to someone else makes you its assigner (they cannot cancel it alone).
        assignedByStaffId: self ? before.assignedByStaffId : access.self,
        acknowledgedAt: self ? now : null,
        acknowledgedByUserId: self ? actor.id : null,
      },
      [
        {
          kind: 'reassigned',
          fromStaffId: before.staffId,
          toStaffId: body.toStaffId as StaffMemberId,
          reason: body.reason ?? null,
        },
        ...(self ? [{ kind: 'acknowledged' as const, occurredAt: now }] : []),
      ],
      'staff_task.reassigned',
      requestId,
    );
    return after;
  });
}

/** This task waits on another you can see; self-links and cycles are refused (A-TSK-6). */
export async function addDependency(
  db: Database,
  actor: Actor,
  id: string,
  body: { expectedVersion: number; dependsOnTaskId: string },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    await lockDependencies(tx); // before the row lock: one lock order, no deadlock
    const { row: before, roles, access } = await loadTaskFor(tx, actor, id, true);
    if (!roles.some((r) => r !== 'reviewer'))
      throw new ForbiddenError(
        'Only the owner or their manager can change what this task waits on.',
      );
    assertVersion(before, body.expectedVersion);
    const dep = await addDependencyRow(tx, actor, access, before, body.dependsOnTaskId);
    return writeTaskChange(
      tx,
      actor,
      before,
      {},
      [{ kind: 'dependency_added', data: { dependencyAdded: dep.id } }],
      'staff_task.dependency_added',
      requestId,
    );
  });
}

/** Both directions of a task's dependencies; tasks outside the reader's scope keep no title. */
export async function dependenciesOf(db: Database, access: TaskAccess, id: string) {
  const rows = await db
    .select()
    .from(deps)
    .where(or(eq(deps.taskId, id as never), eq(deps.dependsOnTaskId, id as never)));
  const ids = [...new Set(rows.flatMap((r) => [r.taskId, r.dependsOnTaskId]))].filter(
    (x) => x !== id,
  );
  const info = ids.length ? await db.select().from(tasks).where(inArray(tasks.id, ids)) : [];
  const of = (x: string) => {
    const t = info.find((i) => i.id === x)!;
    return canSee(access, t)
      ? { id: t.id, title: t.title, status: t.status, visible: true }
      : { id: t.id, title: 'A task you can’t see', status: t.status, visible: false };
  };
  return {
    waitsOn: rows.filter((r) => r.taskId === id).map((r) => of(r.dependsOnTaskId)),
    blocks: rows.filter((r) => r.dependsOnTaskId === id).map((r) => of(r.taskId)),
  };
}
