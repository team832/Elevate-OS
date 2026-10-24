/**
 * One task with everything its detail page and end-to-end report show (brief 2 §12B): people,
 * dated events (oldest first), work updates, dependencies, time summary and the actions the
 * caller may take. Read scope as the list (task-store.ts); the server re-checks every action.
 */
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  departments,
  opsStaffTasks as tasks,
  opsTaskCollaborators,
  opsTaskEvents as events,
  opsTaskUpdates as updates,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { submittedOnTime } from '../domain/staff-tasks';
import {
  allowedActions,
  BRIEF_ROLES,
  isOpenStatus,
  nextAction,
  overlapWarnings,
  taskTimeSummary,
  type TaskRole,
} from '../domain/task-lifecycle';
import type { Actor } from './context';
import { dependenciesOf } from './task-actions';
import { isCollaborator } from './task-access';
import { checklistOf } from './task-checklist';
import { submissionHistory } from './task-submissions';
import { assignmentReadAt } from './task-reminders';
import {
  ctxOf,
  editsTask,
  loadTaskFor,
  mayLogWork,
  mayReassign,
  rolesOn,
  taskAccess,
} from './task-store';

const FIRST = new Set(['created', 'imported']);

export async function taskDetail(db: Database, actor: Actor, id: string, now = new Date()) {
  const { row, access: read, life, ownerUserId } = await loadTaskFor(db, actor, id, false);
  // Actions follow write scope (an all-scope reader such as the auditor may not act).
  const access = can(actor, 'ops:tasks:write')
    ? await taskAccess(db, actor, 'ops:tasks:write')
    : null;
  const roles: TaskRole[] = access
    ? [
        ...rolesOn(access, row),
        ...((await isCollaborator(db, access, row)) ? (['collaborator'] as const) : []),
      ]
    : [];
  const [evs, ups, deps, dept, checklist, history, collaborators, children] = await Promise.all([
    db.select().from(events).where(eq(events.taskId, row.id)).orderBy(asc(events.occurredAt)),
    db.select().from(updates).where(eq(updates.taskId, row.id)).orderBy(asc(updates.recordedAt)),
    dependenciesOf(db, read, row.id),
    row.departmentId
      ? db
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, row.departmentId))
      : [],
    checklistOf(db, row.id),
    submissionHistory(db, row.id),
    db
      .select({ id: staffMembers.id, name: staffMembers.fullName })
      .from(opsTaskCollaborators)
      .innerJoin(staffMembers, eq(staffMembers.id, opsTaskCollaborators.staffId))
      .where(eq(opsTaskCollaborators.taskId, row.id)),
    db
      .select({ status: tasks.status, n: count() })
      .from(tasks)
      .where(eq(tasks.parentTaskId, row.id))
      .groupBy(tasks.status),
  ]);
  const [parent] = row.parentTaskId
    ? await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, row.parentTaskId))
    : [];
  // created/imported first when an acknowledgement shares its instant
  evs.sort((a, b) => +a.occurredAt - +b.occurredAt || +FIRST.has(b.kind) - +FIRST.has(a.kind));
  const staffIds = [
    row.staffId,
    row.assignedByStaffId,
    row.requesterStaffId,
    row.backupStaffId,
    row.reviewerStaffId,
    ...evs.flatMap((e) => [e.fromStaffId, e.toStaffId]),
    ...ups.map((u) => u.authorStaffId),
  ].filter((s): s is NonNullable<typeof s> => Boolean(s));
  const userIds = [...new Set(evs.map((e) => e.actorUserId))];
  const [staff, people] = await Promise.all([
    db
      .select({ id: staffMembers.id, name: staffMembers.fullName })
      .from(staffMembers)
      .where(inArray(staffMembers.id, [...new Set(staffIds)])),
    userIds.length
      ? db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds))
      : [],
  ]);
  // Overlap flags against each author's other entries that day, on any task (never corrected).
  const sameDay = ups.length
    ? await db
        .select()
        .from(updates)
        .where(
          and(
            inArray(updates.authorStaffId, [...new Set(ups.map((u) => u.authorStaffId))]),
            inArray(updates.occurredOn, [...new Set(ups.map((u) => u.occurredOn))]),
          ),
        )
    : [];
  const flags = (u: (typeof ups)[number]) =>
    overlapWarnings(
      u,
      sameDay.filter((o) => o.authorStaffId === u.authorStaffId && o.occurredOn === u.occurredOn),
    );
  const staffName = (s: string | null) => staff.find((x) => x.id === s)?.name ?? null;
  const userName = (u: string) => people.find((x) => x.id === u)?.name ?? 'Unknown user';
  const ctx = await ctxOf(db, roles, actor);
  const childTotal = children.reduce((n, c) => n + c.n, 0);
  const editor = editsTask(roles);
  return {
    ...row,
    staffName: staffName(row.staffId),
    assignedByName: staffName(row.assignedByStaffId),
    requesterName: staffName(row.requesterStaffId),
    backupName: staffName(row.backupStaffId),
    reviewerName: staffName(row.reviewerStaffId),
    departmentName: dept[0]?.name ?? null,
    events: evs.map((e) => ({
      ...e,
      actorName: userName(e.actorUserId),
      fromStaffName: staffName(e.fromStaffId),
      toStaffName: staffName(e.toStaffId),
    })),
    updates: ups.map((u) => ({
      ...u,
      authorName: staffName(u.authorStaffId) ?? 'Unknown',
      corrected: ups.some((c) => c.correctsUpdateId === u.id),
      warnings: flags(u),
    })),
    ...deps,
    waitingOn: deps.waitsOn.filter((d) => isOpenStatus(d.status)).map((d) => d.title),
    time: taskTimeSummary(evs, ups, row.receivedAt, now),
    allowed: allowedActions(life, ctx),
    next: roles.includes('owner') ? nextAction(life, ctx.closedBy) : null,
    checklist,
    ...history,
    collaborators,
    parent: parent ?? null,
    /** Multi-assignment progress: children approved (done) of all children; null = not a parent. */
    group: childTotal
      ? { total: childTotal, done: children.find((c) => c.status === 'done')?.n ?? 0 }
      : null,
    onTime: submittedOnTime(
      row,
      evs.filter((e) => e.kind === 'due_changed'),
    ),
    dueChanges: evs.filter((e) => e.kind === 'due_changed'),
    selfLogged: life.selfLogged,
    /** NOTIFY: when the owner first read the assignment notification (the Read state). */
    noticeReadAt: await assignmentReadAt(db, row.id, ownerUserId),
    canEdit: editor,
    /** I1: the brief and deadline of assigned work are the assigner's. */
    canEditBrief: editor && (life.selfLogged || BRIEF_ROLES.some((r) => roles.includes(r))),
    canLogWork: !!access && mayLogWork({ roles, row, access }),
    canReassign: mayReassign(roles, life) && isOpenStatus(row.status),
    selfStaffId: access?.self ?? null,
    /** Staff the caller may hand work to (null = anyone); the server checks again. */
    assignable: access?.all ? null : [access?.self, ...(access?.managed ?? [])].filter(Boolean),
  };
}
export type TaskDetail = Awaited<ReturnType<typeof taskDetail>>;
