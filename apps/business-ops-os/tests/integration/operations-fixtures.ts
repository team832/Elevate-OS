/**
 * Fixtures for the operations-work integration tests (OPS-060…OPS-069).
 * Fictional people only; every value is unique per call.
 */
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser } from '@elevate/testing';
import { departments, staffMembers, type Database } from '@elevate/database';
import type { DepartmentId, RoleKey, StaffMemberId } from '@elevate/shared-types';
import { POST as createSop } from '../../src/app/api/v1/sops/route';
import { PATCH as patchSop } from '../../src/app/api/v1/sops/[id]/route';
import { POST as sopWorkflow } from '../../src/app/api/v1/sops/[id]/workflow/route';
import type { StaffUser } from './fixtures';

let n = 0;

/** A department with a unique code (fictional). */
export async function department(db: Database, name = 'Test department (fictional)') {
  n += 1;
  const [row] = await db
    .insert(departments)
    .values({
      code: `TEST_OPS_${Date.now().toString(36).toUpperCase()}_${n}`,
      name,
      status: 'active',
    })
    .returning();
  return row!;
}

/** Staff-linked test user, optionally in a department. */
export async function staffIn(
  db: Database,
  roles: RoleKey[],
  options: {
    departmentId?: DepartmentId | null;
    managerId?: StaffMemberId | null;
    name?: string;
  } = {},
): Promise<StaffUser> {
  n += 1;
  const user = await createTestUser(db, {
    roles,
    displayName: options.name ?? `${roles.join('+') || 'staff'} ${n} (fictional)`,
  });
  const [staff] = await db
    .insert(staffMembers)
    .values({
      userId: user.id,
      fullName: user.displayName,
      managerId: options.managerId ?? null,
      departmentId: options.departmentId ?? null,
    })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: staff!.id };
}

/** Staff record without a login (cannot acknowledge; reported separately). */
export async function staffWithoutLogin(db: Database, departmentId: DepartmentId, name: string) {
  const [row] = await db.insert(staffMembers).values({ fullName: name, departmentId }).returning();
  return row!;
}

export const post = (user: { token: string }, json?: unknown, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/x', { method, json });
export const get = (user: { token: string }, path = '/x') => authedRequest(user, path);

/** HTTP status of one route call. */
export const statusOf = async (
  route: Parameters<typeof callRoute>[0],
  req: Request,
  params: Record<string, string> = {},
) => (await callRoute(route, req, params)).status;

/** Create and fully approve an SOP: owner drafts and submits, reviewer recommends, approver approves. */
export async function approvedSop(
  owner: StaffUser,
  reviewer: StaffUser,
  approver: StaffUser,
  title = 'Front desk opening checklist (fictional test SOP)',
) {
  const created = await callRoute<{ id: string; code: string }>(
    createSop,
    post(owner, {
      title,
      ownerStaffId: owner.staffId,
      reviewerStaffId: reviewer.staffId,
      content: '1. Unlock the office.\n2. Check the enquiry register.',
    }),
  );
  if (created.status !== 201) throw new Error(`createSop ${created.status}`);
  const id = created.data!.id;
  const step = async (user: StaffUser, json: unknown) => {
    const r = await callRoute(sopWorkflow, post(user, json), { id });
    if (r.status !== 200) throw new Error(`workflow ${JSON.stringify(json)} → ${r.status}`);
  };
  await step(owner, { action: 'submit' });
  await step(reviewer, { action: 'review', outcome: 'recommend_approval', note: 'Fine' });
  await step(approver, { action: 'approve', comment: 'Approved for the test' });
  return created.data!;
}

export async function setReviewer(owner: StaffUser, sopId: string, reviewerStaffId: string) {
  return callRoute(patchSop, post(owner, { reviewerStaffId }, 'PATCH'), { id: sopId });
}

export async function staffRow(db: Database, id: StaffMemberId) {
  const [row] = await db.select().from(staffMembers).where(eq(staffMembers.id, id));
  return row!;
}
