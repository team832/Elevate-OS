/**
 * HR records test fixtures: staff-linked fictional users WITH an employee record.
 * Everything is fictional (@example.test, "(fictional)").
 */
import { auditEvents, type Database } from '@elevate/database';
import { and, desc, eq } from 'drizzle-orm';
import type { RoleKey, StaffMemberId } from '@elevate/shared-types';
import { registerExistingStaff } from '../../src/server/hr/employee-core';
import { staffUser, type StaffUser } from './fixtures';

export type EmployeeUser = StaffUser & { employeeCode: string };

let n = 0;

/** A user with roles, a staff record (optional manager) and an active employee record. */
export async function employeeUser(
  db: Database,
  roles: RoleKey[],
  options: { managerId?: StaffMemberId | null; name?: string } = {},
): Promise<EmployeeUser> {
  n += 1;
  const user = await staffUser(db, roles, {
    managerId: options.managerId ?? null,
    name: options.name ?? `${roles.join('+') || 'staff'} ${n} (fictional)`,
  });
  const { employeeCode } = await db.transaction((tx) =>
    registerExistingStaff(tx as unknown as Database, user, user.staffId, {
      employmentStatus: 'active',
      employmentStartDate: '2026-01-05',
      workLocation: 'Sikar centre',
    }),
  );
  return { ...user, employeeCode };
}

export function uniqueWorkEmail(prefix = 'employee'): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}@example.test`;
}

/** Latest audit event for an entity + action. */
export async function lastAudit(db: Database, entityId: string, action: string) {
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)))
    .orderBy(desc(auditEvents.at))
    .limit(1);
  return row ?? null;
}
