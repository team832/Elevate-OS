import { eq } from 'drizzle-orm';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { departments, staffMembers, userRoles, users } from '../schema/core';
import { coreReferenceSeeds, type SEED_DEPARTMENTS } from './core-reference';
import { defineSeed, type SeedDefinition } from './registry';
import { PEOPLE } from './sample-people';
import { syncStaffHistory } from './staff-history';

/**
 * One SAMPLE user per role (D-036), made-up people (./sample-people.ts); the teacher is the
 * sample Maths teacher (Academic seeds give them Quant).
 * Email domain `example.test` is reserved, can never receive mail and is refused at
 * sign-in in production (D-030).
 */
export const SEED_USERS: readonly {
  role: RoleKey;
  email: string;
  displayName: string;
  department: (typeof SEED_DEPARTMENTS)[number][0] | null;
  title: string | null;
  managerRole: RoleKey | null;
}[] = [
  {
    role: 'platform_admin',
    email: 'platform-admin@example.test',
    displayName: PEOPLE.platformAdmin,
    department: 'TECHNOLOGY_DATA',
    title: 'Platform administrator',
    managerRole: 'director',
  },
  {
    role: 'director',
    email: 'director@example.test',
    displayName: PEOPLE.director,
    department: 'LEADERSHIP_OPERATIONS',
    title: 'Director',
    managerRole: null,
  },
  {
    role: 'marketing_manager',
    email: 'marketing-manager@example.test',
    displayName: PEOPLE.marketingManager,
    department: 'MARKETING_GROWTH',
    title: 'Marketing manager',
    managerRole: 'director',
  },
  {
    role: 'marketing_contributor',
    email: 'marketing-contributor@example.test',
    displayName: PEOPLE.marketingContributor,
    department: 'MARKETING_GROWTH',
    title: 'Content contributor',
    managerRole: 'marketing_manager',
  },
  {
    role: 'academic_coordinator',
    email: 'academic-coordinator@example.test',
    displayName: PEOPLE.academicCoordinator,
    department: 'ACADEMICS',
    title: 'Academic coordinator',
    managerRole: 'director',
  },
  {
    role: 'teacher',
    email: 'teacher@example.test',
    displayName: PEOPLE.mathsTeacher,
    department: 'ACADEMICS',
    title: 'Maths teacher',
    managerRole: 'academic_coordinator',
  },
  {
    role: 'admissions_counsellor',
    email: 'admissions-counsellor@example.test',
    displayName: PEOPLE.counsellor,
    department: 'ADMISSIONS_COUNSELLING',
    title: 'Admissions counsellor',
    managerRole: 'operations_manager',
  },
  {
    role: 'operations_manager',
    email: 'operations-manager@example.test',
    displayName: PEOPLE.operationsManager,
    department: 'LEADERSHIP_OPERATIONS',
    title: 'Operations manager',
    managerRole: 'director',
  },
  {
    // Brief 23 Oct 2026 §5 (role Proposed): HR for teachers and marketing staff.
    role: 'hr_manager',
    email: 'hr-manager@example.test',
    displayName: PEOPLE.hrManager,
    department: 'HUMAN_RESOURCES',
    title: 'HR manager',
    managerRole: 'director',
  },
  {
    role: 'auditor',
    email: 'auditor@example.test',
    displayName: PEOPLE.auditor,
    department: null,
    title: null,
    managerRole: null,
  },
];

const usersSeed = defineSeed({
  name: 'core.users',
  module: 'platform',
  description: 'One sample user per role (made-up people, @example.test) with SEED_USER_PASSWORD',
  async run({ db, seedUserPassword, hashPassword }) {
    const passwordHash = await hashPassword(seedUserPassword);
    for (const u of SEED_USERS) {
      const [row] = await db
        .insert(users)
        .values({ email: u.email, displayName: u.displayName, passwordHash, status: 'active' })
        .onConflictDoUpdate({
          target: users.email,
          set: { displayName: u.displayName, passwordHash, status: 'active' },
        })
        .returning({ id: users.id });
      if (!row) throw new Error(`Could not upsert seed user ${u.email}`);
      await db.insert(userRoles).values({ userId: row.id, role: u.role }).onConflictDoNothing();
    }
  },
});

const staffSeed = defineSeed({
  name: 'core.staff_members',
  module: 'platform',
  description: 'Sample staff records linked to the seed users',
  dependsOn: ['core.departments', 'core.users'],
  async run({ db }) {
    const deptRows = await db
      .select({ id: departments.id, code: departments.code })
      .from(departments);
    const deptByCode = new Map(deptRows.map((d) => [d.code, d.id]));
    const userIdByRole = new Map<RoleKey, UserId>();
    for (const u of SEED_USERS) {
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
      if (row) userIdByRole.set(u.role, row.id);
    }
    const staffIdByRole = new Map<RoleKey, StaffMemberId>();
    // Two passes: create/update records, then link managers.
    for (const u of SEED_USERS) {
      if (!u.department) continue;
      const userId = userIdByRole.get(u.role);
      if (!userId) continue;
      const values = {
        userId,
        fullName: u.displayName,
        departmentId: deptByCode.get(u.department) ?? null,
        title: u.title,
        status: 'active' as const,
      };
      const [existing] = await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(eq(staffMembers.userId, userId));
      if (existing) {
        await db.update(staffMembers).set(values).where(eq(staffMembers.id, existing.id));
        staffIdByRole.set(u.role, existing.id);
      } else {
        const [created] = await db
          .insert(staffMembers)
          .values(values)
          .returning({ id: staffMembers.id });
        if (created) staffIdByRole.set(u.role, created.id);
      }
    }
    for (const u of SEED_USERS) {
      const id = staffIdByRole.get(u.role);
      if (!id) continue;
      const managerId = u.managerRole ? (staffIdByRole.get(u.managerRole) ?? null) : null;
      await db.update(staffMembers).set({ managerId }).where(eq(staffMembers.id, id));
    }
    await syncStaffHistory(db, [...staffIdByRole.values()], userIdByRole.get('platform_admin')!);
  },
});

export const coreSeeds: readonly SeedDefinition[] = [
  ...coreReferenceSeeds,
  usersSeed,
  staffSeed,
];
