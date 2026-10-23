/** HR's department scope (setting `hr.staff_scope_departments`): who it applies to and its SQL. */
import { eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { departments, opsStaffDepartments, staffMembers, type Database } from '@elevate/database';
import type { DepartmentId } from '@elevate/shared-types';
import type { Actor } from './context';
import { loadSettings } from './settings';

/**
 * The one rule for who is limited to HR's department scope: an HR manager without a role that
 * already reads every record. Callers never apply the scope to the actor's own staff record.
 */
export const isHrScoped = (actor: Actor) =>
  actor.roles.includes('hr_manager') &&
  !actor.roles.some((r) => r === 'operations_manager' || r === 'director' || r === 'auditor');

/**
 * Departments HR covers (setting `hr.staff_scope_departments`, proposed); null = every department.
 * Staff with no department yet stay in scope so HR can place them.
 */
export async function hrScopeDepartments(db: Database): Promise<DepartmentId[] | null> {
  const codes = (await loadSettings(db))['hr.staff_scope_departments'].value.departmentCodes;
  if (!codes.length) return null;
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(inArray(departments.code, codes));
  return rows.map((r) => r.id);
}

/** The staff row has a current (primary or additional) department among `ids`. */
export const inDepartments = (ids: DepartmentId[]) =>
  or(
    inArray(staffMembers.departmentId, ids),
    sql`exists (select 1 from ${opsStaffDepartments} where ${opsStaffDepartments.staffId} = ${staffMembers.id} and ${inArray(opsStaffDepartments.departmentId, ids)} and ${opsStaffDepartments.toDate} is null)`,
  );

/** SQL condition: inside HR's department scope (`null` scope = everyone). */
export const hrScopeWhere = (scope: DepartmentId[] | null) =>
  scope ? or(isNull(staffMembers.departmentId), inDepartments(scope)) : undefined;

/** The department scope for this reader: only HR-scoped readers have one (null = everyone). */
export const hrScopeFor = async (db: Database, actor: Actor) =>
  isHrScoped(actor) ? hrScopeDepartments(db) : null;

/** SQL: staff this reader reaches in HR — their scope, and always their own record. */
export const hrReachWhere = (actor: Actor, scope: DepartmentId[] | null) =>
  scope ? or(eq(staffMembers.userId, actor.id), hrScopeWhere(scope)) : undefined;
