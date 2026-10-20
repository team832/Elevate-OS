/**
 * Fixtures for the HR time tests: staff-linked users that also have an
 * ops.employee_records row (EMP-####, timezone, work location), created with
 * the real `insertEmployee`. Everyone is fictional (@example.test).
 */
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, type TestUser } from '@elevate/testing';
import { auditEvents, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import type { RoleKey, StaffMemberId } from '@elevate/shared-types';
import { insertEmployee } from '../../src/server/hr/employee-core';

export type Employee = TestUser & { staffId: StaffMemberId; employeeCode: string };

let n = 0;
export async function employee(
  db: Database,
  roles: RoleKey[],
  options: {
    managerId?: StaffMemberId | null;
    timezone?: string;
    workLocation?: string | null;
    name?: string;
  } = {},
): Promise<Employee> {
  n += 1;
  const user = await createTestUser(db, {
    roles,
    displayName: options.name ?? `HR time ${roles.join('+') || 'staff'} ${n} (fictional)`,
  });
  const { staffId, employeeCode } = await withTransaction(db, (tx) =>
    insertEmployee(tx, user, {
      fullName: user.displayName,
      userId: user.id,
      managerId: options.managerId ?? null,
      timezone: options.timezone ?? 'Asia/Kolkata',
      workLocation: options.workLocation ?? null,
      employmentStatus: 'active',
    }),
  );
  return { ...user, staffId, employeeCode };
}

export const get = (user: { token: string }, path = '/ops/api/v1/x') => authedRequest(user, path);
export const post = (user: { token: string }, json: unknown = {}, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/x', { method, json });

/** Audit rows for an entity (newest last). */
export async function auditFor(db: Database, entityId: string) {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, entityId))
    .orderBy(auditEvents.at);
  return rows.map((r) => r.action);
}

/** HTTP status of one route call. */
export const statusOf = async (
  route: Parameters<typeof callRoute>[0],
  req: Request,
  params: Record<string, string> = {},
) => (await callRoute(route, req, params)).status;
