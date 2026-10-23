/**
 * Who sees and acts on a task (R3; owner brief 23 Oct 2026 §5, §8): own scope = your tasks and
 * your reports'; all scope = everyone, except an HR manager (organisation `isHrScoped`) whose
 * all scope covers the staff of `hr.staff_scope_departments` (and always their own tasks).
 * `canSee` and its SQL twin `visibleFilter` are the one read rule; `rolesOn` names the roles.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { can, scopeFor, type Permission } from '@elevate/authorization';
import {
  opsStaffTasks as tasks,
  opsTaskCollaborators,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import type { TaskRole } from '../domain/task-lifecycle';
import { accessScope, managedStaffIds, staffIdForUser, type Actor } from './context';
import { hrScopeDepartments, inDepartments, isHrScoped } from './organisation';

type TaskRow = typeof tasks.$inferSelect;

export interface TaskAccess {
  userId: string;
  all: boolean;
  self: StaffMemberId | null;
  /** Direct and indirect reports of `self`. */
  managed: ReadonlySet<string>;
  /** An HR manager's all scope: only these staff (hr.staff_scope_departments); null = everyone. */
  scopeStaff: ReadonlySet<string> | null;
  /** ops:tasks:review scope (own = tasks of your reports). */
  review: 'all' | 'own' | null;
  /** The caller's department (tasks shared with a department). */
  departmentId: string | null;
}

/** Staff of the departments HR manages (primary or a current additional membership); null = all. */
export async function hrScopeStaff(db: Database): Promise<Set<string> | null> {
  const scope = await hrScopeDepartments(db);
  if (!scope) return null;
  const rows = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(inDepartments(scope));
  return new Set(rows.map((r) => r.id));
}

export async function taskAccess(
  db: Database,
  actor: Actor,
  permission: Permission,
): Promise<TaskAccess> {
  const access = await accessScope(db, actor, permission);
  const self = access.scope === 'all' ? await staffIdForUser(db, actor.id) : access.staffId;
  const [me] = self
    ? await db
        .select({ d: staffMembers.departmentId })
        .from(staffMembers)
        .where(eq(staffMembers.id, self))
    : [];
  const review = can(actor, 'ops:tasks:review') ? scopeFor(actor, 'ops:tasks:review') : null;
  const base = { userId: actor.id, self, review, departmentId: me?.d ?? null };
  if (access.scope === 'all') {
    return {
      ...base,
      all: true,
      managed: new Set(),
      scopeStaff: isHrScoped(actor) ? await hrScopeStaff(db) : null,
    };
  }
  const managed = self ? await managedStaffIds(db, self) : [];
  return { ...base, all: false, managed: new Set(managed), scopeStaff: null };
}

/** All scope, limited to HR's departments — never applied to the reader's own tasks. */
const inScope = (a: TaskAccess, staffId: string) =>
  a.all && (!a.scopeStaff || a.scopeStaff.has(staffId) || staffId === a.self);

/** Staff whose tasks this access may assign and own-scope list: yourself, your reports, HR's scope. */
export const coversOwner = (a: TaskAccess, staffId: string | null | undefined) =>
  !!staffId && (inScope(a, staffId) || staffId === a.self || a.managed.has(staffId));

export function rolesOn(a: TaskAccess, t: TaskRow): TaskRole[] {
  const roles: TaskRole[] = [];
  if (a.self && t.staffId === a.self) roles.push('owner');
  // Nobody holds manager or admin powers over work they own or back up (self-logged work is the creator's).
  const mine = !!a.self && (t.staffId === a.self || t.backupStaffId === a.self);
  if (!mine && a.managed.has(t.staffId)) roles.push('manager');
  if (!mine && inScope(a, t.staffId)) roles.push('admin');
  const reviews =
    (a.review === 'all' && (!a.scopeStaff || a.scopeStaff.has(t.staffId))) ||
    (a.review === 'own' && a.managed.has(t.staffId));
  if ((a.self && t.reviewerStaffId === a.self) || (reviews && t.staffId !== a.self))
    roles.push('reviewer');
  if (t.createdBy === a.userId) roles.push('creator');
  return roles;
}

type Visible = Pick<
  TaskRow,
  | 'staffId'
  | 'reviewerStaffId'
  | 'backupStaffId'
  | 'assignedByStaffId'
  | 'status'
  | 'createdBy'
  | 'visibility'
  | 'departmentId'
>;

/**
 * One read rule for detail, report, attachments and writes (`visibleFilter` is its SQL twin for
 * lists). A draft is seen only by whoever assigns it: creator, assigner, manager, all scope.
 */
export function canSee(a: TaskAccess, t: Visible, collaborator = false) {
  const assigner =
    inScope(a, t.staffId) ||
    a.managed.has(t.staffId) ||
    t.createdBy === a.userId ||
    (!!a.self && t.assignedByStaffId === a.self);
  if (t.status === 'draft') return assigner;
  return (
    assigner ||
    (!!a.self && [t.staffId, t.reviewerStaffId, t.backupStaffId].includes(a.self)) ||
    (t.visibility === 'department' && !!a.departmentId && t.departmentId === a.departmentId) ||
    (t.visibility === 'collaborators' && collaborator)
  );
}

/** `canSee` as SQL; `staffId` narrows what you may see, never widens it. */
export function visibleFilter(a: TaskAccess, staffId?: string) {
  const owner = staffId ? eq(tasks.staffId, staffId as StaffMemberId) : undefined;
  if (a.all && !a.scopeStaff) return owner;
  const ids = [...(a.scopeStaff ?? []), ...a.managed] as StaffMemberId[];
  const assigner = or(
    ids.length ? inArray(tasks.staffId, ids) : undefined,
    eq(tasks.createdBy, a.userId as never),
    a.self ? eq(tasks.assignedByStaffId, a.self) : undefined,
  );
  const me = a.self;
  const reader = me
    ? or(
        eq(tasks.staffId, me),
        eq(tasks.reviewerStaffId, me),
        eq(tasks.backupStaffId, me),
        a.departmentId
          ? and(eq(tasks.visibility, 'department'), eq(tasks.departmentId, a.departmentId as never))
          : undefined,
        and(
          eq(tasks.visibility, 'collaborators'),
          sql`exists (select 1 from ${opsTaskCollaborators} where ${opsTaskCollaborators.taskId} = ${tasks.id} and ${opsTaskCollaborators.staffId} = ${me})`,
        ),
      )
    : undefined;
  return and(owner, or(assigner, and(sql`${tasks.status} <> 'draft'`, reader)));
}

export async function isCollaborator(db: Database, a: TaskAccess, t: TaskRow) {
  if (!a.self || t.visibility !== 'collaborators') return false;
  const [c] = await db
    .select({ s: opsTaskCollaborators.staffId })
    .from(opsTaskCollaborators)
    .where(and(eq(opsTaskCollaborators.taskId, t.id), eq(opsTaskCollaborators.staffId, a.self)));
  return !!c;
}
