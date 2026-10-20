/**
 * Tasks (OPS-016, OPS-060…OPS-063): create/update, status changes with
 * completion and blocker rules, dependencies with cycle detection, list views
 * with filters and pagination, append-only comments (hidden with a reason),
 * document references, supervisor review of completed tasks, and the unified
 * activity history. Escalations and reminders: ./escalations.ts.
 * Own scope: read = owner/accountable/backup is me; write = owner is me;
 * comments and references = owner/accountable/backup is me.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { scopeFor } from '@elevate/authorization';
import {
  departments,
  opsEscalations,
  opsTaskComments,
  opsTaskDependencies,
  opsTaskReferences,
  opsTaskReviewRequirements,
  opsTaskReviews,
  opsTasks,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId, TaskId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  checkCommentHide,
  checkTaskReviewDecision,
  checkTaskTransition,
  describeTaskActivity,
  isOpenTask,
  OPEN_TASK_STATUSES,
  taskFlags,
  taskReviewState,
  wouldCreateCycle,
  type IsoDate,
  type TaskReviewStatus,
  type TaskStatus,
} from '../domain';
import {
  accessScope,
  activeStaff,
  clean,
  nextCode,
  notFound,
  scopeCovers,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type AccessScope,
  type Actor,
} from './context';
import {
  auditTrail,
  defined,
  notifyOthers,
  opsAudit,
  rowById,
  staffUserLookup,
} from './ops-common';
import type { CreateTaskInput, UpdateTaskInput } from './schemas';
import type {
  reviewRequirementBody,
  taskReferenceBody,
  taskReviewBody,
  TaskSearchQuery,
} from './work-schemas';

type TaskRow = typeof opsTasks.$inferSelect;
type ReviewRow = typeof opsTaskReviews.$inferSelect;

const audit = opsAudit('task');

/** All-scope task writer (operations manager). */
const isTaskManager = (actor: Actor) => scopeFor(actor, 'ops:tasks:write') === 'all';

const getTask = (db: Database, id: string, lock = false): Promise<TaskRow> =>
  rowById(db, opsTasks, id, 'Task', lock);

const participants = (t: TaskRow) => [t.ownerStaffId, t.accountableStaffId, t.backupStaffId];

function assertParticipant(access: AccessScope, task: TaskRow, what: string) {
  if (!scopeCovers(access, participants(task)))
    throw new ForbiddenError(`You can only ${what} tasks you own, are accountable for or back up.`);
}

function assertOwnerScope(access: AccessScope, task: TaskRow, what = 'update') {
  if (!scopeCovers(access, [task.ownerStaffId]))
    throw new ForbiddenError(`You can only ${what} tasks you own.`);
}

/** Notify task people (never the actor) with a link to the task. */
const notifyTask = (
  tx: Database,
  actor: Actor,
  userIds: readonly UserId[],
  task: TaskRow,
  kind: string,
  title: string,
  body?: string | null,
) =>
  notifyOthers(tx, actor, userIds, {
    kind,
    title,
    body,
    link: `/ops/tasks/${task.id}`,
    entityType: 'task',
    entityId: task.id,
  });

const notifyAssigned = async (tx: Database, actor: Actor, task: TaskRow) =>
  notifyTask(
    tx,
    actor,
    await userIdsForStaff(tx, [task.ownerStaffId]),
    task,
    'task.assigned',
    `Task assigned: ${task.title} (${task.code})`,
  );

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
      .values({ ...(input as typeof opsTasks.$inferInsert), code, createdBy: actor.id })
      .returning();
    if (!task) throw new Error('task insert returned no row');
    await audit(tx, actor, task.id, 'task.created', { after: task }, requestId);
    await notifyAssigned(tx, actor, task);
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
    assertOwnerScope(access, before);
    if (!isOpenTask(before.status as TaskStatus))
      throw new ConflictError('Reopen the task before editing it.');
    const owner = 'ownerStaffId' in input ? input.ownerStaffId : before.ownerStaffId;
    const backup = 'backupStaffId' in input ? input.backupStaffId : before.backupStaffId;
    if (owner && backup && owner === backup)
      throw new ValidationError('The backup must be a different person from the owner.');
    const [after] = await tx
      .update(opsTasks)
      .set(defined(input) as Partial<typeof opsTasks.$inferInsert>)
      .where(eq(opsTasks.id, before.id))
      .returning();
    await audit(tx, actor, before.id, 'task.updated', { before, after }, requestId);
    if (after && after.ownerStaffId !== before.ownerStaffId) await notifyAssigned(tx, actor, after);
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

async function pendingReview(tx: Database, taskId: string, lock = false) {
  const q = tx
    .select()
    .from(opsTaskReviews)
    .where(and(eq(opsTaskReviews.taskId, taskId as TaskId), eq(opsTaskReviews.status, 'pending')))
    .limit(1);
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

const reviewRequirement = async (db: Database, taskId: TaskId) =>
  (
    await db
      .select()
      .from(opsTaskReviewRequirements)
      .where(eq(opsTaskReviewRequirements.taskId, taskId))
  )[0];

/** Who is told that a review is waiting: named reviewer, else accountable owner, else ops managers. */
async function reviewRecipients(tx: Database, task: TaskRow, reviewerStaffId: string | null) {
  const named = await userIdsForStaff(tx, [reviewerStaffId]);
  if (named.length) return named;
  const accountable = await userIdsForStaff(tx, [task.accountableStaffId]);
  if (accountable.length) return accountable;
  return userIdsWithRole(tx, 'operations_manager');
}

/** Open the next review cycle for a task that was just completed (OPS-062). */
async function submitForReview(
  tx: Database,
  actor: Actor,
  task: TaskRow,
  reviewerStaffId: StaffMemberId | null,
  requestId?: string,
): Promise<ReviewRow> {
  const [last] = await tx
    .select({ cycle: opsTaskReviews.cycle })
    .from(opsTaskReviews)
    .where(eq(opsTaskReviews.taskId, task.id))
    .orderBy(desc(opsTaskReviews.cycle))
    .limit(1);
  const [review] = await tx
    .insert(opsTaskReviews)
    .values({
      taskId: task.id,
      cycle: (last?.cycle ?? 0) + 1,
      submittedBy: actor.id,
      reviewerStaffId,
    })
    .returning();
  if (!review) throw new Error('review insert returned no row');
  await audit(tx, actor, task.id, 'task.review_submitted', { after: review }, requestId);
  await notifyTask(
    tx,
    actor,
    await reviewRecipients(tx, task, reviewerStaffId),
    task,
    'task.review_requested',
    `Review needed: ${task.title} (${task.code})`,
    'The task was completed and needs a supervisor review.',
  );
  return review;
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
    assertOwnerScope(access, before);
    const blockers = (await openBlockers(tx, before.id)).map((b) => b.code);
    const check = checkTaskTransition({
      ...input,
      from: before.status as TaskStatus,
      hasOwner: Boolean(before.ownerStaffId),
      openBlockers: blockers,
    });
    if (!check.ok) {
      const Err = ['BLOCKED_BY_OPEN_TASKS', 'ILLEGAL', 'NO_CHANGE'].includes(check.code)
        ? ConflictError
        : ValidationError;
      throw new Err(check.message, {
        details: { code: check.code, blockers: check.blockers ?? [] },
      });
    }
    if (before.status === 'completed' && (await pendingReview(tx, before.id)))
      throw new ConflictError(
        'A supervisor review is pending; the reviewer accepts it or returns the task.',
        { details: { code: 'REVIEW_PENDING' } },
      );
    const now = new Date();
    const patch: Partial<typeof opsTasks.$inferInsert> = {
      status: input.to,
      statusReason: clean(input.reason),
      statusChangedAt: now,
      blockedSince: input.to === 'blocked' ? now : null,
    };
    if (input.to === 'completed') {
      Object.assign(patch, {
        completedAt: now,
        completedBy: actor.id,
        completionNote: clean(input.completionNote),
        evidenceLink: clean(input.evidenceLink),
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
    await audit(
      tx,
      actor,
      before.id,
      check.overrideUsed ? 'task.completed_with_override' : 'task.status_changed',
      {
        before: { status: before.status },
        after: {
          status: input.to,
          reason: input.reason ?? null,
          blockers,
          override: check.overrideUsed ? input.blockerOverrideReason : null,
        },
      },
      requestId,
    );
    let review: ReviewRow | null = null;
    if (input.to === 'completed' && after) {
      const requirement = await reviewRequirement(tx, before.id);
      if (requirement)
        review = await submitForReview(tx, actor, after, requirement.reviewerStaffId, requestId);
    }
    return { ...(after as TaskRow), awaitingReview: Boolean(review) };
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
    assertOwnerScope(await accessScope(tx, actor, 'ops:tasks:write'), task, 'change');
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
        { details: { cycle: cycle.path } },
      );
    }
    const [row] = await tx
      .insert(opsTaskDependencies)
      .values({ taskId: task.id, blockedByTaskId: blocker.id, createdBy: actor.id })
      .onConflictDoNothing()
      .returning();
    const after = { blockedBy: blocker.code };
    await audit(tx, actor, task.id, 'task.dependency_added', { after }, requestId);
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
    assertOwnerScope(access, task, 'change');
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
    await audit(tx, actor, task.id, 'task.dependency_removed', { before: removed[0] }, requestId);
    return { removed: true };
  });
}

// --- lists ---------------------------------------------------------------------------------------

export type TaskView = TaskSearchQuery['view'];

interface TaskFilters {
  departmentId?: string;
  /** A staff member; `role` says which role they hold on the task. */
  staffId?: string;
  role?: 'any' | 'owner' | 'accountable' | 'backup';
  /** Code or title contains (case-insensitive). */
  q?: string;
}

function personCondition(staffId: string, role: TaskFilters['role'] = 'any'): SQL {
  const id = staffId as StaffMemberId;
  if (role === 'owner') return eq(opsTasks.ownerStaffId, id);
  if (role === 'accountable') return eq(opsTasks.accountableStaffId, id);
  if (role === 'backup') return eq(opsTasks.backupStaffId, id);
  return or(
    eq(opsTasks.ownerStaffId, id),
    eq(opsTasks.accountableStaffId, id),
    eq(opsTasks.backupStaffId, id),
  ) as SQL;
}

/** Escape LIKE wildcards in user input. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function listTasks(
  db: Database,
  actor: Actor,
  view: TaskView = 'open',
  now = new Date(),
  filters: TaskFilters = {},
) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const conditions: SQL[] = [];
  const mine = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
  if (access.scope === 'own' || view === 'mine') {
    if (!mine) return [];
    conditions.push(personCondition(mine, view === 'mine' ? filters.role : 'any'));
  }
  if (filters.staffId) conditions.push(personCondition(filters.staffId, filters.role));
  if (filters.departmentId)
    conditions.push(eq(opsTasks.departmentId, filters.departmentId as DepartmentId));
  if (filters.q) {
    const like = `%${likeEscape(filters.q)}%`;
    conditions.push(or(ilike(opsTasks.title, like), ilike(opsTasks.code, like)) as SQL);
  }
  if (view === 'awaiting_review') conditions.push(eq(opsTasks.status, 'completed'));
  else if (view !== 'all') conditions.push(inArray(opsTasks.status, [...OPEN_TASK_STATUSES]));
  if (view === 'blocked') conditions.push(eq(opsTasks.status, 'blocked'));
  const rows = await db
    .select({ task: opsTasks, ownerName: staffMembers.fullName, departmentName: departments.name })
    .from(opsTasks)
    .leftJoin(staffMembers, eq(staffMembers.id, opsTasks.ownerStaffId))
    .leftJoin(departments, eq(departments.id, opsTasks.departmentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(opsTasks.dueDate), asc(opsTasks.code))
    .limit(1000);
  const ids = rows.map((r) => r.task.id);
  const escalations = ids.length
    ? await db
        .select({ taskId: opsEscalations.taskId, level: opsEscalations.level })
        .from(opsEscalations)
        .where(
          and(
            inArray(opsEscalations.taskId, ids),
            inArray(opsEscalations.status, ['open', 'acknowledged']),
          ),
        )
    : [];
  const pendingRows = ids.length
    ? await db
        .select({ taskId: opsTaskReviews.taskId })
        .from(opsTaskReviews)
        .where(and(inArray(opsTaskReviews.taskId, ids), eq(opsTaskReviews.status, 'pending')))
    : [];
  const pending = new Set(pendingRows.map((r) => r.taskId as string));
  const backupIds = [
    ...new Set(rows.map((r) => r.task.backupStaffId).filter((x): x is StaffMemberId => Boolean(x))),
  ];
  const backups = backupIds.length
    ? await db
        .select({ id: staffMembers.id, fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(inArray(staffMembers.id, backupIds))
    : [];
  const out = rows.map((r) => {
    const open = escalations.filter((e) => e.taskId === r.task.id);
    return {
      ...r.task,
      ownerName: r.ownerName,
      backupName: backups.find((b) => b.id === r.task.backupStaffId)?.fullName ?? null,
      departmentName: r.departmentName,
      ...flagsOf(r.task, now),
      openEscalationLevel: open.length ? Math.max(...open.map((e) => e.level)) : null,
      awaitingReview: pending.has(r.task.id),
    };
  });
  if (view === 'overdue') return out.filter((t) => t.flags.includes('overdue'));
  if (view === 'escalated') return out.filter((t) => t.openEscalationLevel !== null);
  if (view === 'awaiting_review') return out.filter((t) => t.awaitingReview);
  return out;
}

const flagsOf = (t: TaskRow, now: Date) =>
  taskFlags(
    {
      status: t.status as TaskStatus,
      ownerStaffId: t.ownerStaffId,
      dueDate: t.dueDate as IsoDate | null,
    },
    now,
  );

/**
 * Task list with page-based pagination. Without `page` / `pageSize` every
 * matching task (≤ 1000) is returned in one page, as before.
 */
export async function searchTasks(
  db: Database,
  actor: Actor,
  query: Partial<TaskSearchQuery> = {},
  now = new Date(),
) {
  const all = await listTasks(db, actor, query.view ?? 'open', now, query);
  const paged = query.page !== undefined || query.pageSize !== undefined;
  const pageSize = paged ? (query.pageSize ?? 50) : Math.max(1, all.length);
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(query.page ?? 1, pages);
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    pages,
  };
}

// --- detail --------------------------------------------------------------------------------------

async function readableTask(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const task = await getTask(db, id);
  if (!scopeCovers(access, participants(task)))
    throw new ForbiddenError('You can only see tasks assigned to you.');
  return { access, task };
}

/** The people checked by `checkTaskReviewDecision`. */
const reviewPeople = (
  actor: Actor,
  task: TaskRow,
  review: ReviewRow,
  reviewerStaffId: string | null,
  userOf: (sid: string | null) => UserId | null,
) => ({
  deciderUserId: actor.id,
  submitterUserId: review.submittedBy,
  ownerUserId: userOf(task.ownerStaffId),
  reviewerUserId: userOf(reviewerStaffId),
  accountableUserId: userOf(task.accountableStaffId),
  deciderIsManager: isTaskManager(actor),
});

async function reviewSummary(db: Database, actor: Actor, task: TaskRow) {
  const requirement = await reviewRequirement(db, task.id);
  const history = await db
    .select()
    .from(opsTaskReviews)
    .where(eq(opsTaskReviews.taskId, task.id))
    .orderBy(desc(opsTaskReviews.cycle));
  const latest = history[0] ?? null;
  const reviewerStaffId = latest?.reviewerStaffId ?? requirement?.reviewerStaffId ?? null;
  let canDecide = false;
  let decideBlocker: string | null = null;
  if (latest?.status === 'pending' && scopeFor(actor, 'ops:tasks:write')) {
    const people = reviewPeople(actor, task, latest, reviewerStaffId, await staffUserLookup(db));
    const check = checkTaskReviewDecision({ status: 'pending', decision: 'accept', ...people });
    canDecide = check.ok;
    decideBlocker = check.ok ? null : check.message;
  }
  const [reviewer] = reviewerStaffId
    ? await db
        .select({ fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, reviewerStaffId))
    : [];
  return {
    required: Boolean(requirement),
    requirement: requirement
      ? { reviewerStaffId: requirement.reviewerStaffId, note: requirement.note }
      : null,
    reviewerName: reviewer?.fullName ?? null,
    state: taskReviewState({
      required: Boolean(requirement),
      latest: latest ? { status: latest.status as TaskReviewStatus } : null,
    }),
    latest,
    history,
    canDecide,
    decideBlocker,
  };
}

export async function getTaskDetail(db: Database, actor: Actor, id: string, now = new Date()) {
  const { access, task } = await readableTask(db, actor, id);
  const people = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(
      inArray(
        staffMembers.id,
        participants(task).filter((x): x is StaffMemberId => Boolean(x)),
      ),
    );
  const name = (sid: string | null) => people.find((p) => p.id === sid)?.fullName ?? null;
  const escalations = await db
    .select({ e: opsEscalations, recipientName: staffMembers.fullName })
    .from(opsEscalations)
    .leftJoin(staffMembers, eq(staffMembers.id, opsEscalations.recipientStaffId))
    .where(eq(opsEscalations.taskId, task.id))
    .orderBy(asc(opsEscalations.level));
  const references = await db
    .select({ ref: opsTaskReferences, addedByName: users.displayName })
    .from(opsTaskReferences)
    .innerJoin(users, eq(users.id, opsTaskReferences.addedBy))
    .where(eq(opsTaskReferences.taskId, task.id))
    .orderBy(asc(opsTaskReferences.createdAt));
  const linked = (join: PgColumn, where: PgColumn) =>
    db
      .select({
        id: opsTasks.id,
        code: opsTasks.code,
        title: opsTasks.title,
        status: opsTasks.status,
      })
      .from(opsTaskDependencies)
      .innerJoin(opsTasks, eq(opsTasks.id, join))
      .where(eq(where, task.id));
  const writeScope = scopeFor(actor, 'ops:tasks:write');
  const ownWrite = writeScope === 'own' && access.scope === 'own';
  return {
    task,
    ownerName: name(task.ownerStaffId),
    accountableName: name(task.accountableStaffId),
    backupName: name(task.backupStaffId),
    ...flagsOf(task, now),
    blockedBy: await linked(opsTaskDependencies.blockedByTaskId, opsTaskDependencies.taskId),
    blocks: await linked(opsTaskDependencies.taskId, opsTaskDependencies.blockedByTaskId),
    escalations: escalations.map((e) => ({ ...e.e, recipientName: e.recipientName })),
    canWrite: writeScope === 'all' || (ownWrite && access.staffId === task.ownerStaffId),
    /** May comment and add references (owner / accountable / backup, or a manager). */
    canContribute: writeScope === 'all' || (ownWrite && scopeCovers(access, participants(task))),
    canManage: writeScope === 'all',
    comments: await listTaskComments(db, actor, task),
    references: references.map((r) => ({
      ...r.ref,
      addedByName: r.addedByName,
      canRemove: !r.ref.removedAt && (writeScope === 'all' || r.ref.addedBy === actor.id),
    })),
    review: await reviewSummary(db, actor, task),
  };
}

// --- comments (append-only) ----------------------------------------------------------------------

/** Comments, oldest first. A hidden comment's body is shown only to all-scope readers. */
async function listTaskComments(db: Database, actor: Actor, task: TaskRow) {
  const rows = await db
    .select({ c: opsTaskComments, authorName: users.displayName })
    .from(opsTaskComments)
    .innerJoin(users, eq(users.id, opsTaskComments.authorUserId))
    .where(eq(opsTaskComments.taskId, task.id))
    .orderBy(asc(opsTaskComments.createdAt), asc(opsTaskComments.id));
  const seesHidden = scopeFor(actor, 'ops:tasks:read') === 'all';
  const manager = isTaskManager(actor);
  return rows.map(({ c, authorName }) => ({
    id: c.id,
    authorName,
    createdAt: c.createdAt,
    hidden: Boolean(c.hiddenAt),
    body: c.hiddenAt && !seesHidden ? null : c.body,
    hiddenAt: c.hiddenAt,
    hiddenReason: c.hiddenReason,
    canHide: !c.hiddenAt && (manager || c.authorUserId === actor.id),
  }));
}

export async function getTaskComments(db: Database, actor: Actor, taskId: string) {
  const { task } = await readableTask(db, actor, taskId);
  return listTaskComments(db, actor, task);
}

export async function addTaskComment(
  db: Database,
  actor: Actor,
  taskId: string,
  input: { body: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  const body = input.body.trim();
  if (!body)
    throw new ValidationError('Write a comment.', {
      details: [{ location: 'body', path: ['body'], message: 'Required' }],
    });
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    assertParticipant(access, task, 'comment on');
    const [comment] = await tx
      .insert(opsTaskComments)
      .values({ taskId: task.id, authorUserId: actor.id, body })
      .returning();
    if (!comment) throw new Error('comment insert returned no row');
    const after = { commentId: comment.id, length: body.length };
    await audit(tx, actor, task.id, 'task.comment_added', { after }, requestId);
    await notifyTask(
      tx,
      actor,
      await userIdsForStaff(tx, participants(task)),
      task,
      'task.comment',
      `New comment on ${task.code}: ${task.title}`,
    );
    return comment;
  });
}

/** "Delete" = hide with a reason (author or operations manager). The body is never edited. */
export async function hideTaskComment(
  db: Database,
  actor: Actor,
  taskId: string,
  commentId: string,
  input: { reason: string },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  return withTransaction(db, async (tx) => {
    const [comment] = await tx
      .select()
      .from(opsTaskComments)
      .where(
        and(
          eq(opsTaskComments.id, commentId as typeof opsTaskComments.$inferSelect.id),
          eq(opsTaskComments.taskId, taskId as TaskId),
        ),
      )
      .for('update');
    if (!comment) notFound('Comment');
    const check = checkCommentHide({
      actorUserId: actor.id,
      authorUserId: comment.authorUserId,
      actorIsManager: isTaskManager(actor),
      alreadyHidden: Boolean(comment.hiddenAt),
      reason: input.reason,
    });
    if (!check.ok) {
      const Err = {
        NOT_ALLOWED: ForbiddenError,
        ALREADY_HIDDEN: ConflictError,
        REASON_REQUIRED: ValidationError,
      }[check.code];
      throw new Err(check.message);
    }
    const reason = input.reason.trim();
    const [after] = await tx
      .update(opsTaskComments)
      .set({ hiddenAt: new Date(), hiddenBy: actor.id, hiddenReason: reason })
      .where(eq(opsTaskComments.id, comment.id))
      .returning();
    await audit(
      tx,
      actor,
      comment.taskId,
      'task.comment_hidden',
      { before: { commentId: comment.id }, after: { commentId: comment.id, hiddenReason: reason } },
      requestId,
    );
    return after;
  });
}

// --- document references -------------------------------------------------------------------------

/** A location is free text; anything that looks like a URL must be http(s). */
function checkReferenceLocation(location: string): string | null {
  const v = location.trim();
  if (!v) return 'Say where the document is.';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v) && !/^[a-z]:[\\/]/i.test(v))
    return 'Links must start with http:// or https://.';
  return null;
}

export async function addTaskReference(
  db: Database,
  actor: Actor,
  taskId: string,
  input: z.output<typeof taskReferenceBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  const problem = checkReferenceLocation(input.location);
  if (problem)
    throw new ValidationError(problem, {
      details: [{ location: 'body', path: ['location'], message: problem }],
    });
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    assertParticipant(access, task, 'add references to');
    const [ref] = await tx
      .insert(opsTaskReferences)
      .values({ ...input, taskId: task.id, location: input.location.trim(), addedBy: actor.id })
      .returning();
    await audit(tx, actor, task.id, 'task.reference_added', { after: ref }, requestId);
    return ref;
  });
}

export async function removeTaskReference(
  db: Database,
  actor: Actor,
  taskId: string,
  referenceId: string,
  input: { reason: string },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  return withTransaction(db, async (tx) => {
    const [ref] = await tx
      .select()
      .from(opsTaskReferences)
      .where(
        and(
          eq(opsTaskReferences.id, referenceId as typeof opsTaskReferences.$inferSelect.id),
          eq(opsTaskReferences.taskId, taskId as TaskId),
        ),
      )
      .for('update');
    if (!ref) notFound('Reference');
    if (ref.removedAt) throw new ConflictError('This reference is already removed.');
    if (ref.addedBy !== actor.id && !isTaskManager(actor))
      throw new ForbiddenError(
        'Only the person who added it or an operations manager can remove it.',
      );
    const [after] = await tx
      .update(opsTaskReferences)
      .set({ removedAt: new Date(), removedBy: actor.id, removedReason: input.reason.trim() })
      .where(eq(opsTaskReferences.id, ref.id))
      .returning();
    await audit(tx, actor, ref.taskId, 'task.reference_removed', { before: ref, after }, requestId);
    return after;
  });
}

// --- supervisor review ---------------------------------------------------------------------------

function assertTaskManager(actor: Actor, message: string) {
  if (!isTaskManager(actor)) throw new ForbiddenError(message);
}

/** An operations manager requires (or changes) a supervisor review for a task. */
export async function setTaskReviewRequirement(
  db: Database,
  actor: Actor,
  taskId: string,
  input: z.output<typeof reviewRequirementBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  assertTaskManager(actor, 'Only an operations manager can require a supervisor review.');
  if (input.reviewerStaffId) {
    const reviewer = await activeStaff(db, input.reviewerStaffId, 'reviewerStaffId');
    if (!reviewer.userId)
      throw new ValidationError('The reviewer needs a login to record a review.', {
        details: [{ location: 'body', path: ['reviewerStaffId'], message: 'No login' }],
      });
  }
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    if (input.reviewerStaffId && input.reviewerStaffId === task.ownerStaffId)
      throw new ValidationError('The reviewer cannot be the task owner.', {
        details: [{ location: 'body', path: ['reviewerStaffId'], message: 'Same as owner' }],
      });
    const before = await reviewRequirement(tx, task.id);
    const values = {
      taskId: task.id,
      reviewerStaffId: (input.reviewerStaffId as StaffMemberId | null) ?? null,
      note: input.note ?? null,
      requiredBy: actor.id,
    };
    const [after] = before
      ? await tx
          .update(opsTaskReviewRequirements)
          .set(values)
          .where(eq(opsTaskReviewRequirements.taskId, task.id))
          .returning()
      : await tx.insert(opsTaskReviewRequirements).values(values).returning();
    await audit(tx, actor, task.id, 'task.review_required', { before, after }, requestId);
    return after;
  });
}

export async function removeTaskReviewRequirement(
  db: Database,
  actor: Actor,
  taskId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  assertTaskManager(actor, 'Only an operations manager can remove a review requirement.');
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    if (await pendingReview(tx, task.id))
      throw new ConflictError('A review is pending; decide it before removing the requirement.');
    const removed = await tx
      .delete(opsTaskReviewRequirements)
      .where(eq(opsTaskReviewRequirements.taskId, task.id))
      .returning();
    if (!removed.length) notFound('Review requirement');
    const data = { before: removed[0] };
    await audit(tx, actor, task.id, 'task.review_requirement_removed', data, requestId);
    return { removed: true };
  });
}

/** Accept the completion, or return the task (reopens it to In progress with the note). */
export async function decideTaskReview(
  db: Database,
  actor: Actor,
  taskId: string,
  input: z.output<typeof taskReviewBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  return withTransaction(db, async (tx) => {
    const task = await getTask(tx, taskId, true);
    const review = await pendingReview(tx, task.id, true);
    if (!review) throw new InvalidStateTransitionError('No review is pending for this task.');
    const reviewerStaffId =
      review.reviewerStaffId ?? (await reviewRequirement(tx, task.id))?.reviewerStaffId ?? null;
    const check = checkTaskReviewDecision({
      status: review.status as TaskReviewStatus,
      decision: input.decision,
      note: input.note,
      ...reviewPeople(actor, task, review, reviewerStaffId, await staffUserLookup(tx)),
    });
    if (!check.ok) {
      const Err =
        check.code === 'NOTE_REQUIRED'
          ? ValidationError
          : check.code === 'NOT_PENDING'
            ? InvalidStateTransitionError
            : ForbiddenError;
      throw new Err(check.message, { details: { code: check.code } });
    }
    const accept = input.decision === 'accept';
    const now = new Date();
    const note = clean(input.note);
    const [after] = await tx
      .update(opsTaskReviews)
      .set({
        status: accept ? 'accepted' : 'returned',
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: note,
      })
      .where(eq(opsTaskReviews.id, review.id))
      .returning();
    const action = accept ? 'task.review_accepted' : 'task.review_returned';
    await audit(tx, actor, task.id, action, { before: review, after }, requestId);
    if (!accept) {
      const statusReason = `Returned by the reviewer: ${note}`;
      await tx
        .update(opsTasks)
        .set({
          status: 'in_progress',
          statusReason,
          statusChangedAt: now,
          blockedSince: null,
          completedAt: null,
          completedBy: null,
        })
        .where(eq(opsTasks.id, task.id));
      await audit(
        tx,
        actor,
        task.id,
        'task.status_changed',
        { before: { status: task.status }, after: { status: 'in_progress', reason: statusReason } },
        requestId,
      );
    }
    await notifyTask(
      tx,
      actor,
      await userIdsForStaff(tx, [task.ownerStaffId]),
      task,
      action,
      accept
        ? `Review accepted: ${task.title} (${task.code})`
        : `Task returned by the reviewer: ${task.title} (${task.code})`,
      note,
    );
    return after;
  });
}

// --- activity history ----------------------------------------------------------------------------

/**
 * Unified activity of a task, newest first: status changes, reassignments,
 * edits, dependencies, comments, references, escalations, reviews and reminders,
 * built from the audit log (every change is audited in the same transaction).
 */
export async function getTaskActivity(db: Database, actor: Actor, taskId: string, limit = 300) {
  const { task } = await readableTask(db, actor, taskId);
  const rows = await auditTrail(db, 'task', task.id, Math.min(Math.max(limit, 1), 1000));
  const staff = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers);
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.fullName ?? null;
  return rows.map(({ e, actorName }) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    actorName: actorName ?? (e.actorType === 'system' ? 'System job' : null),
    ...describeTaskActivity(
      { action: e.action, before: e.before, after: e.after, metadata: e.metadata },
      nameOf,
    ),
  }));
}

/** For the approvals inbox: pending task reviews this actor may decide (never their own). */
export async function listTaskReviewsForDecider(db: Database, actor: Actor) {
  if (!scopeFor(actor, 'ops:tasks:write')) return [];
  const rows = await db
    .select({ review: opsTaskReviews, task: opsTasks, submitterName: users.displayName })
    .from(opsTaskReviews)
    .innerJoin(opsTasks, eq(opsTasks.id, opsTaskReviews.taskId))
    .innerJoin(users, eq(users.id, opsTaskReviews.submittedBy))
    .where(eq(opsTaskReviews.status, 'pending'))
    .orderBy(asc(opsTaskReviews.submittedAt));
  if (!rows.length) return [];
  const userOf = await staffUserLookup(db);
  const requirements = await db
    .select()
    .from(opsTaskReviewRequirements)
    .where(
      inArray(
        opsTaskReviewRequirements.taskId,
        rows.map((r) => r.task.id),
      ),
    );
  return rows.filter(({ review, task }) => {
    const reviewerStaffId =
      review.reviewerStaffId ??
      requirements.find((q) => q.taskId === task.id)?.reviewerStaffId ??
      null;
    return checkTaskReviewDecision({
      status: 'pending',
      decision: 'accept',
      ...reviewPeople(actor, task, review, reviewerStaffId, userOf),
    }).ok;
  });
}
