/** A fictional marketing user with a staff record in Marketing & Growth (calendar and ideas tests). */
import { departments, staffMembers, type Database } from '@elevate/database';
import { createTestUser, type TestUser } from '@elevate/testing';

export type Staff = TestUser & { staffId: string };

export async function marketingStaff(
  db: Database,
  role: 'marketing_manager' | 'marketing_contributor',
  name: string,
): Promise<Staff> {
  const user = await createTestUser(db, { roles: [role] });
  const [dept] = await db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoUpdate({ target: departments.code, set: { name: 'Marketing & Growth' } })
    .returning({ id: departments.id });
  const [s] = await db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: name, departmentId: dept!.id })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}
