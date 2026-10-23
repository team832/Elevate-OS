/**
 * Task lifecycle actions, reassignment and dependencies (brief 2 §5–6, A-TSK-5/6). Each is one
 * transaction: lock, check `expectedVersion`, decide, write the task, its event and an audit row.
 * Warnings (open dependencies) are returned, never enforced: finishing B never completes A.
 */
import { and, count, eq, inArray, notInArray, or } from 'drizzle-orm';
import {
  opsStaffTasks as tasks,
  opsTaskDependencies as deps,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istClock, resolveTaskState } from '../domain/staff-tasks';
import { decide, isOpenStatus, type TaskAction } from '../domain/task-lifecycle';
import { activeStaff, type Actor } from './context';
import { fieldError } from './ops-common';
import { afterChange } from './staff-tasks';
import type { TaskActionBody } from './staff-tasks-schemas';
import { deliverTask, notifyStaff } from './task-links';
import { latestVersion, namesOf, reviewComment, reviewWork, submitWork } from './task-submissions';
import {
  addDependencyRow,
  assertVersion,
  canSee,
  coversOwner,
  ctxOf,
  editsTask,
  loadTaskFor,
  lockDependencies,
  mayReassign,
  refuse,
  writeTaskChange,
  type TaskAccess,
  type TaskRow,
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

/** M3: a multi-assignment parent closes only after every person's task is closed. */
async function assertChildrenClosed(tx: Database, id: string) {
  const [open] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(
      and(eq(tasks.parentTaskId, id as never), notInArray(tasks.status, ['done', 'cancelled'])),
    );
  if (open!.n)
    throw new InvalidStateTransitionError(
      `${open!.n} of the people's tasks under this one ${open!.n === 1 ? 'is' : 'are'} still open.`,
    );
}

const WARN_ON: readonly TaskAction[] = ['start', 'submit', 'complete', 'approve'];
/** Who hears about a step: [recipients, notification kind, title prefix]. */
const NOTICES: Partial<Record<TaskAction, ['owner' | 'reviewer', string, string]>> = {
  submit: ['reviewer', 'task.submitted', 'Submitted for review'],
  approve: ['owner', 'task.approved', 'Approved'],
  request_changes: ['owner', 'task.changes_requested', 'Changes requested'],
  reopen: ['owner', 'task.reopened', 'Reopened'],
  clarify: ['reviewer', 'task.clarification_requested', 'Question'],
};

/**
 * One lifecycle step (A-TSK-5). The blocked flag, acknowledgement and comments never change the
 * status; submit records a submission version; approve / request changes record a review of the
 * latest submission; assigning a draft delivers it. Notifications go to the reviewer (submit,
 * clarification) or the owner (decisions, reopen).
 */
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
    const d = decide(action, life, await ctxOf(tx, roles, actor), body.reason);
    refuse(d);
    if (action === 'complete' || action === 'approve') await assertChildrenClosed(tx, before.id);
    const status = d.to ?? before.status;
    const { state } = resolveTaskState(before, {
      status,
      reason: d.to === 'cancelled' ? body.reason : undefined,
    });
    const now = new Date();
    let set: Partial<TaskRow> = {
      ...state,
      completedAt: status === 'done' ? (before.completedAt ?? now) : null,
    };
    let data: Record<string, unknown> | undefined;
    if (action === 'acknowledge')
      set = { ...set, acknowledgedAt: now, acknowledgedByUserId: actor.id };
    if (action === 'block' || action === 'hold') {
      const kind = action === 'block' ? 'blocked' : 'on_hold';
      set = { ...set, blockedAt: now, blockedKind: kind, blockedReason: body.reason! };
      data = { kind };
    }
    if (action === 'resume')
      set = { ...set, blockedAt: null, blockedKind: null, blockedReason: null };
    if (action === 'reopen') set = { ...set, approvedAt: null };
    if (action === 'submit') {
      const r = await submitWork(tx, actor, before, body, now);
      set = { ...set, ...r.set };
      data = r.data;
    }
    if (action === 'approve' || action === 'request_changes') {
      const note = action === 'approve' ? (body.note ?? null) : body.reason!;
      const decision = action === 'approve' ? 'approved' : 'changes_requested';
      const r = await reviewWork(tx, actor, before, decision, note, roles, now);
      set = { ...set, ...r.set };
      data = { ...r.data, note };
    }
    if (action === 'comment' && roles.includes('reviewer') && !roles.includes('owner'))
      await reviewComment(tx, actor, before, body.reason!);
    let after = await writeTaskChange(
      tx,
      actor,
      before,
      set,
      [
        {
          kind: d.event,
          fromStatus: d.to ? before.status : null,
          toStatus: d.to,
          reason: body.reason ?? null,
          occurredAt: now,
          data,
        },
      ],
      `staff_task.${action}`,
      requestId,
    );
    if (action === 'publish') {
      after = await deliverTask(tx, actor, after);
      // X4: assigning a multi-person draft assigns and delivers each person's task with it.
      const kids = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, before.id), eq(tasks.status, 'draft')))
        .for('update');
      for (const kid of kids) {
        const event = { kind: d.event, fromStatus: kid.status, toStatus: d.to, occurredAt: now };
        const sent = await writeTaskChange(
          tx,
          actor,
          kid,
          { status: 'pending' },
          [event],
          `staff_task.${action}`,
          requestId,
        );
        await deliverTask(tx, actor, sent);
      }
    }
    const notice = NOTICES[action];
    if (notice) {
      const [to, kind, prefix] = notice;
      const me = (await namesOf(tx, [actor.id])).get(actor.id);
      const who = (to === 'owner' ? me?.reviewer : me?.name) ?? 'Someone';
      const text = body.reason ?? body.note;
      await notifyStaff(
        tx,
        actor,
        to === 'owner' ? [after.staffId] : [after.reviewerStaffId ?? after.assignedByStaffId],
        after.id,
        {
          kind,
          title: `${prefix}: ${after.title}`,
          // Brief §11 wording: "Submitted by Satish at 4:42 PM." / "Changes requested by HR: …".
          body: text
            ? `${prefix} by ${who}: ${text}`
            : `${action === 'submit' ? 'Submitted' : prefix} by ${who} at ${istClock(now)}.`,
        },
      );
    }
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
    // X2: a submitted version is decided first, so its approval can never credit the next owner.
    if (before.status === 'in_review')
      throw new InvalidStateTransitionError('Ask for changes or approve first.');
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
          // X2: versions up to this one were handed in by an earlier owner (never approvable).
          data: { submissionVersion: await latestVersion(tx, before.id) },
        },
        ...(self ? [{ kind: 'acknowledged' as const, occurredAt: now }] : []),
      ],
      'staff_task.reassigned',
      requestId,
    );
    return self || after.status === 'draft' ? after : deliverTask(tx, actor, after);
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
    if (!editsTask(roles))
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
