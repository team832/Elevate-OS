/**
 * One task with everything its detail page and end-to-end report show (brief 2 §12B): people,
 * dated events (oldest first), work updates, dependencies, time summary and the actions the
 * caller may take. Read scope as the list (task-store.ts); the server re-checks every action.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  departments,
  opsStaffTasks as tasks,
  opsTaskImportBatches,
  opsTaskEvents as events,
  opsTaskUpdates as updates,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { TaskStatus } from '../domain/staff-tasks';
import {
  ACTION_RULES,
  allowedActions,
  isOpenStatus,
  overlapWarnings,
  taskTimeSummary,
} from '../domain/task-lifecycle';
import type { Actor } from './context';
import { dependenciesOf } from './task-actions';
import { ctxOf, lifecycleOf, loadTaskFor, mayReassign, rolesOn, taskAccess } from './task-store';

const FIRST = new Set(['created', 'imported']);

export async function taskDetail(db: Database, actor: Actor, id: string, now = new Date()) {
  const { row, access: read, life } = await loadTaskFor(db, actor, id, false);
  // Actions follow write scope (an all-scope reader such as the auditor may not act).
  const access = can(actor, 'ops:tasks:write')
    ? await taskAccess(db, actor, 'ops:tasks:write')
    : null;
  const roles = access ? rolesOn(access, row) : [];
  const [evs, ups, deps, dept] = await Promise.all([
    db.select().from(events).where(eq(events.taskId, row.id)).orderBy(asc(events.occurredAt)),
    db.select().from(updates).where(eq(updates.taskId, row.id)).orderBy(asc(updates.recordedAt)),
    dependenciesOf(db, read, row.id),
    row.departmentId
      ? db
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, row.departmentId))
      : [],
  ]);
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
  const ctx = await ctxOf(db, roles);
  const editor = roles.some((r) => r !== 'reviewer');
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
    selfLogged: life.selfLogged,
    canEdit: editor,
    canLogWork: editor || (!!access?.self && row.backupStaffId === access.self),
    canReassign: mayReassign(roles, life) && isOpenStatus(row.status),
    selfStaffId: access?.self ?? null,
    /** Staff the caller may hand work to (null = anyone); the server checks again. */
    assignable: access?.all ? null : [access?.self, ...(access?.managed ?? [])].filter(Boolean),
  };
}
export type TaskDetail = Awaited<ReturnType<typeof taskDetail>>;

const ROW_ACTIONS = new Set(['start', 'block', 'hold', 'resume', 'complete', 'reopen']);

/** For My day's row forms: each task's version and the statuses the caller may set now. */
export async function rowStatusOptions(db: Database, actor: Actor, ids: string[]) {
  if (!ids.length || !can(actor, 'ops:tasks:write')) return new Map<string, RowOptions>();
  const access = await taskAccess(db, actor, 'ops:tasks:write');
  const rows = await db
    .select({
      task: tasks,
      ownerUserId: staffMembers.userId,
      importStaffId: opsTaskImportBatches.staffId,
    })
    .from(tasks)
    .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
    .leftJoin(opsTaskImportBatches, eq(opsTaskImportBatches.id, tasks.importBatchId))
    .where(inArray(tasks.id, ids as never[]));
  const { closedBy } = await ctxOf(db, []);
  const out = new Map<string, RowOptions>();
  for (const { task: r, ownerUserId, importStaffId } of rows) {
    const ctx = { roles: rolesOn(access, r), closedBy };
    const next = allowedActions(lifecycleOf(r, ownerUserId, importStaffId), ctx)
      .filter((a) => ROW_ACTIONS.has(a))
      .map((a) => ACTION_RULES[a].to!);
    out.set(r.id, { version: r.version, statuses: [...new Set([r.status, ...next])] });
  }
  return out;
}
export type RowOptions = { version: number; statuses: TaskStatus[] };
