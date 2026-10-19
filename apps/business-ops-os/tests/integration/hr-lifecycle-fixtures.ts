/**
 * HR lifecycle test fixtures: the cast (fictional), employee records with a
 * login, assets with an open assignment, and small request helpers. Codes use
 * a high counter range so they never collide with service-generated codes.
 */
import { createTestUser, authedRequest, callRoute, type TestUser } from '@elevate/testing';
import {
  opsAssetAssignments,
  opsAssets,
  opsEmployeeRecords,
  type Database,
} from '@elevate/database';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { setupReference, staffUser, type StaffUser } from './fixtures';

let n = 0;
const next = () => (n += 1);

export interface Cast {
  hrManager: StaffUser;
  hrContributor: StaffUser;
  director: StaffUser;
  opsManager: StaffUser;
  recruiter: StaffUser;
  otherRecruiter: StaffUser;
  interviewer: StaffUser;
  deptManager: StaffUser;
  auditor: TestUser;
  outsider: StaffUser;
}

export async function setupCast(db: Database): Promise<Cast> {
  await setupReference(db);
  const hrManager = await staffUser(db, ['hr_manager'], { name: 'HR Manager (fictional)' });
  const deptManager = await staffUser(db, ['department_manager'], {
    name: 'Dept Manager (fictional)',
  });
  return {
    hrManager,
    hrContributor: await staffUser(db, ['hr_contributor'], { name: 'HR Contributor (fictional)' }),
    director: await staffUser(db, ['director'], { name: 'Director (fictional)' }),
    opsManager: await staffUser(db, ['operations_manager'], { name: 'Ops Manager (fictional)' }),
    recruiter: await staffUser(db, ['recruiter'], { name: 'Recruiter A (fictional)' }),
    otherRecruiter: await staffUser(db, ['recruiter'], { name: 'Recruiter B (fictional)' }),
    // Interviewers need recruitment read access (see the integration request for department managers).
    interviewer: await staffUser(db, ['recruiter'], { name: 'Interviewer (fictional)' }),
    deptManager,
    auditor: await createTestUser(db, { roles: ['auditor'], displayName: 'Auditor (fictional)' }),
    outsider: await staffUser(db, ['employee'], { name: 'Outsider (fictional)' }),
  };
}

/** A staff member with a login AND an employee record (status given). */
export async function employeeWithLogin(
  db: Database,
  options: {
    managerId?: StaffMemberId | null;
    status?: 'onboarding' | 'active';
    roles?: RoleKey[];
  } = {},
): Promise<StaffUser & { employeeCode: string }> {
  const person = await staffUser(db, options.roles ?? ['employee'], {
    managerId: options.managerId ?? null,
    name: `Employee ${next()} (fictional)`,
  });
  const employeeCode = `EMP-${String(9000 + next()).padStart(4, '0')}`;
  await db.insert(opsEmployeeRecords).values({
    staffId: person.staffId,
    employeeCode,
    employmentStatus: options.status ?? 'active',
    employmentStartDate: '2025-04-01',
  });
  return { ...person, employeeCode };
}

/** Register an asset and assign it (open assignment) to a staff member. */
export async function assignAsset(db: Database, staffId: StaffMemberId, assignedBy: UserId) {
  const [asset] = await db
    .insert(opsAssets)
    .values({
      code: `AST-${String(90000 + next()).padStart(5, '0')}`,
      name: 'Laptop (fictional)',
      category: 'laptop',
      status: 'assigned',
    })
    .returning();
  const [assignment] = await db
    .insert(opsAssetAssignments)
    .values({ assetId: asset!.id, staffId, assignedOn: '2025-04-01', assignedBy })
    .returning();
  return { asset: asset!, assignment: assignment! };
}

export const json = (user: { token: string }, body?: unknown, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/hr/x', { method, json: body ?? {} });
export const get = (user: { token: string }, path = '/ops/api/v1/hr/x') =>
  authedRequest(user, path);

/** Route call helper with typed data. */
export function call<T = Record<string, unknown>>(
  handler: Parameters<typeof callRoute>[0],
  request: Request,
  params?: Record<string, string>,
) {
  return callRoute<T>(handler, request, params);
}

export function uniqueCandidateEmail() {
  return `candidate-${Date.now().toString(36)}-${next()}@example.test`;
}
