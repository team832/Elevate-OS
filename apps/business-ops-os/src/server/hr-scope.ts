/**
 * Record-level scope for HR resources (D-028). Every HR service uses this
 * instead of `accessScope` because `own` means something wider here:
 *
 * - `all`: every employee.
 * - `own`: the staff member linked to the user, plus — when the user holds the
 *   `department_manager` role — everyone in their reporting chain (direct and
 *   indirect reports via core.staff_members.manager_id).
 *
 * A user with no staff record has an empty `own` scope (sees nothing).
 * Deciders may never decide their own request (`assertNotSelf`), whatever scope.
 */
import { requirePermission, type Permission } from '@elevate/authorization';
import { staffMembers, type Database } from '@elevate/database';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { staffIdForUser, type Actor } from './context';

export type HrScope =
  | { scope: 'all'; staffId: StaffMemberId | null }
  | { scope: 'own'; staffId: StaffMemberId | null; staffIds: ReadonlySet<StaffMemberId> };

/** All direct and indirect reports of `managerId` (loop-safe). */
export function reportsOf(
  staff: readonly { id: StaffMemberId; managerId: StaffMemberId | null }[],
  managerId: StaffMemberId,
): Set<StaffMemberId> {
  const children = new Map<StaffMemberId, StaffMemberId[]>();
  for (const s of staff) {
    if (!s.managerId) continue;
    const list = children.get(s.managerId) ?? [];
    list.push(s.id);
    children.set(s.managerId, list);
  }
  const out = new Set<StaffMemberId>();
  const queue = [...(children.get(managerId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id) || id === managerId) continue;
    out.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Permission check + HR scope. Throws FORBIDDEN when the permission is not held. */
export async function hrScope(
  db: Database,
  actor: Actor,
  permission: Permission,
): Promise<HrScope> {
  const granted = requirePermission(actor, permission);
  const staffId = await staffIdForUser(db, actor.id);
  if (granted === 'all') return { scope: 'all', staffId };
  const staffIds = new Set<StaffMemberId>();
  if (staffId) {
    staffIds.add(staffId);
    if (actor.roles.includes('department_manager')) {
      const staff = await db
        .select({ id: staffMembers.id, managerId: staffMembers.managerId })
        .from(staffMembers);
      for (const id of reportsOf(staff, staffId)) staffIds.add(id);
    }
  }
  return { scope: 'own', staffId, staffIds };
}

/** True when the scope covers the employee `staffId`. */
export function hrCovers(scope: HrScope, staffId: string | null | undefined): boolean {
  if (scope.scope === 'all') return true;
  return Boolean(staffId) && scope.staffIds.has(staffId as StaffMemberId);
}

export function assertHrScope(
  scope: HrScope,
  staffId: string | null | undefined,
  what = 'this employee’s records',
): void {
  if (!hrCovers(scope, staffId)) throw new ForbiddenError(`You cannot access ${what}.`);
}

/** Staff ids the scope is limited to, or null for `all` (use in WHERE … IN). */
export function hrScopeIds(scope: HrScope): StaffMemberId[] | null {
  return scope.scope === 'all' ? null : [...scope.staffIds];
}

/** No self-approval of sensitive requests (D-028, AGENTS.md: approvals). */
export function assertNotSelf(
  deciderStaffId: string | null | undefined,
  subjectStaffId: string | null | undefined,
  what = 'your own request',
): void {
  if (deciderStaffId && subjectStaffId && deciderStaffId === subjectStaffId) {
    throw new ForbiddenError(`You cannot decide ${what}.`);
  }
}
