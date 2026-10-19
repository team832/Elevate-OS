/**
 * Tasks (OPS-016): create/update, status changes with completion and blocker
 * rules, dependencies with cycle detection, list views. Escalations: ./escalations.ts.
 * Own scope: read = owner/accountable/backup is me; write = owner is me.
 */
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import {
  departments,
  opsEscalations,
  opsTaskDependencies,
  opsTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, TaskId } from '@elevate/shared-types';
import {
  checkTaskTransition,
  isOpenTask,
  taskFlags,
  wouldCreateCycle,
  type IsoDate,
  type TaskStatus,
} from '../domain';
import {
  accessScope,
  activeStaff,
  nextCode,
  notFound,
  scopeCovers,
  staffIdForUser,
  userIdsForStaff,
  type Actor,
} from './context';
import type { CreateTaskInput, UpdateTaskInput } from './schemas';

export type TaskRow = typeof opsTasks.$inferSelect;

async function getTask(db: Database, id: string, lock = false): Promise<TaskRow> {
  const q = db
    .select()
    .from(opsTasks)
    .where(eq(opsTasks.id, id as TaskId))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) notFound('Task');
  return row;
}

async function validatePeople(db: Database, input: Partial<CreateTaskInput>) {
  for (const field of ['ownerStaffId', 'accountableStaffId', 'backupStaffId'] as const) {
    const v = input[field];
    if (v) await activeStaff(db, v, field);
  }
  if (input.ownerStaffId && input.backupStaffId && input.ownerStaffId === input.backupStaffId)
    throw new ValidationError('The backup must be a different person from the owner.', {
      details: [{ location: 'body', path: ['backupStaffId'], message: 'Same as owner' }],
    });
}

export async function createTask(
  db: Database,
  actor: Actor,
  input: CreateTaskInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  if (access.scope === 'own') {
    if (!access.staffId) throw new ForbiddenError('Your account is not linked to a staff record.');
    if (input.ownerStaffId && input.ownerStaffId !== access.staffId)
      throw new ForbiddenError('You can only create tasks owned by yourself.');
    input = { ...input, ownerStaffId: access.staffId };
  }
  await validatePeople(db, input);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'task', 'ops.tasks');
    const [task] = await tx
      .insert(opsTasks)
      .values({
        code,
        title: input.title,
        description: input.description ?? null,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        ownerStaffId: (input.ownerStaffId as StaffMemberId | null) ?? null,
        accountableStaffId: (input.accountableStaffId as StaffMemberId | null) ?? null,
        backupStaffId: (input.backupStaffId as StaffMemberId | null) ?? null,
        dueDate: input.dueDate ?? null,
        priority: input.priority,
        leadId: (input.leadId as never) ?? null,
        admissionId: (input.admissionId as never) ?? null,
        sopId: (input.sopId as never) ?? null,
        decisionId: (input.decisionId as never) ?? null,
        projectId: (input.projectId as never) ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (!task) throw new Error('task insert returned no row');
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      after: task,
      requestId,
    });
    const recipients = (await userIdsForStaff(tx, [task.ownerStaffId])).filter(
      (u) => u !== actor.id,
    );
    if (recipients.length)
      await notify(tx, {
        userIds: recipients,
        module: 'ops',
        kind: 'task.assigned',
        title: `Task assigned: ${task.title} (${task.code})`,
        link: `/ops/tasks/${task.id}`,
        entityType: 'task',
        entityId: task.id,
      });
    return task;
  });
}

export async function updateTask(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateTaskInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  if (
    access.scope === 'own' &&
    ('ownerStaffId' in input || 'accountableStaffId' in input || 'backupStaffId' in input)
  )
    throw new ForbiddenError('Only an operations manager can reassign tasks.');
  await validatePeople(db, input);
  return withTransaction(db, async (tx) => {
    const before = await getTask(tx, id, true);
    if (!scopeCovers(access, [before.ownerStaffId]))
      throw new ForbiddenError('You can only update tasks you own.');
    if (!isOpenTask(before.status as TaskStatus))
      throw new ConflictError('Reopen the task before editing it.');
    const owner = 'ownerStaffId' in input ? input.ownerStaffId : before.ownerStaffId;
    const backup = 'backupStaffId' in input ? input.backupStaffId : before.backupStaffId;
    if (owner && backup && owner === backup)
      throw new ValidationError('The backup must be a different person from the owner.');
    const patch = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Partial<typeof opsTasks.$inferInsert>;
    const [after] = await tx
      .update(opsTasks)
      .set(patch)
      .where(eq(opsTasks.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'task.updated',
      entityType: 'task',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    if (after && after.ownerStaffId !== before.ownerStaffId) {
      const recipients = (await userIdsForStaff(tx, [after.ownerStaffId])).filter(
        (u) => u !== actor.id,
      );
      if (recipients.length)
        await notify(tx, {
          userIds: recipients,
          module: 'ops',
          kind: 'task.assigned',
          title: `Task assigned: ${after.title} (${after.code})`,
          link: `/ops/tasks/${after.id}`,
          entityType: 'task',
          entityId: after.id,
        });
    }
    return after as TaskRow;
  });
}

async function openBlockers(db: Database, taskId: string) {
  return db
    .select({ id: opsTasks.id, code: opsTasks.code, status: opsTasks.status })
    .from(opsTaskDependencies)
    .innerJoin(opsTasks, eq(opsTasks.id, opsTaskDependencies.blockedByTaskId))
    .where(eq(opsTaskDependencies.taskId, taskId as TaskId))
    .then((rows) => rows.filter((r) => isOpenTask(r.status as TaskStatus)));
}

export async function changeTaskStatus(
  db: Database,
  actor: Actor,
  id: string,
  input: {
    to: TaskStatus;
    reason?: string | null;
    completionNote?: string | null;
    evidenceLink?: string | null;
    blockerOverrideReason?: string | null;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  return withTransaction(db, async (tx) => {
    const before = await getTask(tx, id, true);
    if (!scopeCovers(access, [before.ownerStaffId]))
      throw new ForbiddenError('You can only update tasks you own.');
    const blockers = await openBlockers(tx, before.id);
    const check = checkTaskTransition({
      from: before.status as TaskStatus,
      to: input.to,
      reason: input.reason,
      completionNote: input.completionNote,
      evidenceLink: input.evidenceLink,
      hasOwner: Boolean(before.ownerStaffId),
      openBlockers: blockers.map((b) => b.code),
      blockerOverrideReason: input.blockerOverrideReason,
    });
    if (!check.ok) {
      const Err =
        check.code === 'BLOCKED_BY_OPEN_TASKS' ||
        check.code === 'ILLEGAL' ||
        check.code === 'NO_CHANGE'
          ? ConflictError
          : ValidationError;
      throw new Err(check.message, {
        details: { code: check.code, blockers: check.blockers ?? [] },
      });
    }
    const now = new Date();
    const patch: Partial<typeof opsTasks.$inferInsert> = {
      status: input.to,
      statusReason: input.reason?.trim() || null,
      statusChangedAt: now,
      blockedSince: input.to === 'blocked' ? now : null,
    };
    if (input.to === 'completed') {
      Object.assign(patch, {
        completedAt: now,
        completedBy: actor.id,
        completionNote: input.completionNote?.trim() || null,
        evidenceLink: input.evidenceLink?.trim() || null,
        blockerOverrideReason: check.overrideUsed ? input.blockerOverrideReason?.trim() : null,
      });
    }
    if (before.status === 'completed' || before.status === 'cancelled') {
      Object.assign(patch, { completedAt: null, completedBy: null });
    }
    const [after] = await tx
      .update(opsTasks)
      .set(patch)
      .where(eq(opsTasks.id, before.id))
      .returning();
    if (!isOpenTask(input.to)) {
      await tx
        .update(opsEscalations)
        .set({
          status: 'resolved',
          resolvedAt: now,
          resolvedBy: actor.id,
          resolutionNote: `Task ${input.to}`,
        })
        .where(
          and(
            eq(opsEscalations.taskId, before.id),
            inArray(opsEscalations.status, ['open', 'acknowledged']),
          ),
        );
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: check.overrideUsed ? 'task.completed_with_override' : 'task.status_changed',
      entityType: 'task',
      entityId: before.id,
      before: { status: before.status },
      after: {
        status: input.to,
        reason: input.reason ?? null,
        blockers: blockers.map((b) => b.code),
        override: check.overrideUsed ? input.blockerOverrideReason : null,
      },
      requestId,
    });
    return after as TaskRow;
  });
}

export async function addDependency(
  db: Database,
  actor: Actor,
  taskId: string,
  blockedByTaskId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  if (taskId === blockedByTaskId) throw new ValidationError('A task cannot block itself.');
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    const access = await accessScope(tx, actor, 'ops:tasks:write');
    if (!scopeCovers(access, [task.ownerStaffId]))
      throw new ForbiddenError('You can only change tasks you own.');
    const blocker = await getTask(tx, blockedByTaskId);
    // Serialise graph changes so two concurrent edges cannot form a cycle together.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops.task_dependencies'))`);
    const edges = await tx
      .select({ from: opsTaskDependencies.taskId, to: opsTaskDependencies.blockedByTaskId })
      .from(opsTaskDependencies);
    const cycle = wouldCreateCycle(edges, task.id, blocker.id);
    if (cycle.cycle) {
      const codes = await tx
        .select({ id: opsTasks.id, code: opsTasks.code })
        .from(opsTasks)
        .where(inArray(opsTasks.id, cycle.path as TaskId[]));
      const byId = new Map(codes.map((c) => [c.id as string, c.code]));
      throw new ConflictError(
        `That dependency would create a cycle: ${cycle.path.map((p) => byId.get(p) ?? p).join(' → ')}.`,
        {
          details: { cycle: cycle.path },
        },
      );
    }
    const [row] = await tx
      .insert(opsTaskDependencies)
      .values({ taskId: task.id, blockedByTaskId: blocker.id, createdBy: actor.id })
      .onConflictDoNothing()
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'task.dependency_added',
      entityType: 'task',
      entityId: task.id,
      after: { blockedBy: blocker.code },
      requestId,
    });
    return row ?? { taskId: task.id, blockedByTaskId: blocker.id };
  });
}

export async function removeDependency(
  db: Database,
  actor: Actor,
  taskId: string,
  blockedByTaskId: string,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    if (!scopeCovers(access, [task.ownerStaffId]))
      throw new ForbiddenError('You can only change tasks you own.');
    const removed = await tx
      .delete(opsTaskDependencies)
      .where(
        and(
          eq(opsTaskDependencies.taskId, task.id),
          eq(opsTaskDependencies.blockedByTaskId, blockedByTaskId as TaskId),
        ),
      )
      .returning();
    if (!removed.length) notFound('Dependency');
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'task.dependency_removed',
      entityType: 'task',
      entityId: task.id,
      before: removed[0],
      requestId,
    });
    return { removed: true };
  });
}

export type TaskView = 'mine' | 'overdue' | 'escalated' | 'blocked' | 'open' | 'all';

export async function listTasks(
  db: Database,
  actor: Actor,
  view: TaskView = 'open',
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const conditions: SQL[] = [];
  const mine = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
  if (access.scope === 'own' || view === 'mine') {
    if (!mine) return [];
    conditions.push(
      or(
        eq(opsTasks.ownerStaffId, mine),
        eq(opsTasks.accountableStaffId, mine),
        eq(opsTasks.backupStaffId, mine),
      ) as SQL,
    );
  }
  if (view !== 'all')
    conditions.push(
      inArray(opsTasks.status, ['not_started', 'in_progress', 'waiting', 'at_risk', 'blocked']),
    );
  if (view === 'blocked') conditions.push(eq(opsTasks.status, 'blocked'));
  const rows = await db
    .select({ task: opsTasks, ownerName: staffMembers.fullName, departmentName: departments.name })
    .from(opsTasks)
    .leftJoin(staffMembers, eq(staffMembers.id, opsTasks.ownerStaffId))
    .leftJoin(departments, eq(departments.id, opsTasks.departmentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(opsTasks.dueDate), asc(opsTasks.code))
    .limit(1000);
  const escalations = rows.length
    ? await db
        .select({
          taskId: opsEscalations.taskId,
          level: opsEscalations.level,
          status: opsEscalations.status,
        })
        .from(opsEscalations)
        .where(
          and(
            inArray(
              opsEscalations.taskId,
              rows.map((r) => r.task.id),
            ),
            inArray(opsEscalations.status, ['open', 'acknowledged']),
          ),
        )
    : [];
  const out = rows.map((r) => {
    const { flags, daysOverdue } = taskFlags(
      {
        status: r.task.status as TaskStatus,
        ownerStaffId: r.task.ownerStaffId,
        dueDate: r.task.dueDate as IsoDate | null,
      },
      now,
    );
    const open = escalations.filter((e) => e.taskId === r.task.id);
    return {
      ...r.task,
      ownerName: r.ownerName,
      departmentName: r.departmentName,
      flags,
      daysOverdue,
      openEscalationLevel: open.length ? Math.max(...open.map((e) => e.level)) : null,
    };
  });
  if (view === 'overdue') return out.filter((t) => t.flags.includes('overdue'));
  if (view === 'escalated') return out.filter((t) => t.openEscalationLevel !== null);
  return out;
}

export async function getTaskDetail(db: Database, actor: Actor, id: string, now = new Date()) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const task = await getTask(db, id);
  if (!scopeCovers(access, [task.ownerStaffId, task.accountableStaffId, task.backupStaffId]))
    throw new ForbiddenError('You can only see tasks assigned to you.');
  const people = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(
      inArray(
        staffMembers.id,
        [task.ownerStaffId, task.accountableStaffId, task.backupStaffId].filter(
          (x): x is StaffMemberId => Boolean(x),
        ),
      ),
    );
  const name = (sid: string | null) => people.find((p) => p.id === sid)?.fullName ?? null;
  const blockedBy = await db
    .select({
      id: opsTasks.id,
      code: opsTasks.code,
      title: opsTasks.title,
      status: opsTasks.status,
    })
    .from(opsTaskDependencies)
    .innerJoin(opsTasks, eq(opsTasks.id, opsTaskDependencies.blockedByTaskId))
    .where(eq(opsTaskDependencies.taskId, task.id));
  const blocks = await db
    .select({
      id: opsTasks.id,
      code: opsTasks.code,
      title: opsTasks.title,
      status: opsTasks.status,
    })
    .from(opsTaskDependencies)
    .innerJoin(opsTasks, eq(opsTasks.id, opsTaskDependencies.taskId))
    .where(eq(opsTaskDependencies.blockedByTaskId, task.id));
  const escalations = await db
    .select({ e: opsEscalations, recipientName: staffMembers.fullName })
    .from(opsEscalations)
    .leftJoin(staffMembers, eq(staffMembers.id, opsEscalations.recipientStaffId))
    .where(eq(opsEscalations.taskId, task.id))
    .orderBy(asc(opsEscalations.level));
  return {
    task,
    ownerName: name(task.ownerStaffId),
    accountableName: name(task.accountableStaffId),
    backupName: name(task.backupStaffId),
    ...taskFlags(
      {
        status: task.status as TaskStatus,
        ownerStaffId: task.ownerStaffId,
        dueDate: task.dueDate as IsoDate | null,
      },
      now,
    ),
    blockedBy,
    blocks,
    escalations: escalations.map((e) => ({ ...e.e, recipientName: e.recipientName })),
    canWrite:
      scopeFor(actor, 'ops:tasks:write') === 'all' ||
      (scopeFor(actor, 'ops:tasks:write') === 'own' &&
        access.scope === 'own' &&
        access.staffId === task.ownerStaffId),
  };
}
