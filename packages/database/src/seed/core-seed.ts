import { eq } from 'drizzle-orm';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { branches, departments, programmes, staffMembers, userRoles, users } from '../schema/core';
import { defineSeed, type SeedDefinition } from './registry';
import { syncStaffHistory } from './staff-history';

/**
 * Departments from the legacy "Suggested departments" table in
 * Elevate-Education-Agent-Handover-2026-10-15.zip →
 * elevate-education-operations/SYSTEM_ARCHITECTURE.md ("This is a starting model
 * and will be adjusted to Elevate Education's actual structure"). Seeded as
 * `provisional` until the owner confirms the structure.
 */
export const SEED_DEPARTMENTS = [
  ['LEADERSHIP_OPERATIONS', 'Leadership & Operations', 'Strategy execution and coordination'],
  ['ADMISSIONS_COUNSELLING', 'Admissions & Counselling', 'Lead-to-enrolment journey'],
  ['ACADEMICS', 'Academics', 'Teaching plan and delivery quality'],
  ['CURRICULUM_CONTENT', 'Curriculum & Content', 'Learning-material production'],
  ['FACULTY_MANAGEMENT', 'Faculty Management', 'Allocation, readiness, and performance'],
  ['STUDENT_SUCCESS', 'Student Success', 'Attendance, engagement, support, retention'],
  ['EXAMINATIONS', 'Examinations', 'Assessment planning and results'],
  ['PARENT_COMMUNICATION', 'Parent Communication', 'Structured updates and issue resolution'],
  ['MARKETING_GROWTH', 'Marketing & Growth', 'Awareness and lead generation'],
  ['FINANCE', 'Finance', 'Fees, payroll, budgeting, and controls'],
  ['HUMAN_RESOURCES', 'Human Resources', 'Hiring, onboarding, attendance, and performance'],
  ['ADMINISTRATION_FACILITIES', 'Administration & Facilities', 'Physical operations and logistics'],
  ['TECHNOLOGY_DATA', 'Technology & Data', 'Systems, access, support, and reporting'],
] as const;

/**
 * Programme catalogue (business planning data, not personal data — D-016).
 * Status reflects the legacy record as of 2026-10-17: CA Foundation planning is
 * paused with a confirmed 1 March 2027 start, so it is `planned`.
 */
export const SEED_PROGRAMMES = [
  ['CLAT', 'CLAT UG preparation', 'Common Law Admission Test (UG) preparation.', 'active'],
  [
    'IPMAT',
    'IPMAT preparation',
    'IPM entrance preparation (IPMAT, IIM Indore; owner shorthand "IAM IP mat"). The IIM Bangalore UG admission test (IIMB UG-AT) is coached in the same batch; its syllabus finishes earlier because that exam comes first (owner, 21 Oct 2026).',
    'active',
  ],
  ['CUET', 'CUET (UG) preparation', 'Common University Entrance Test (UG) preparation.', 'active'],
  ['COMMERCE_11_12', 'Class 11–12 Commerce', 'Class 11–12 Commerce board preparation.', 'active'],
  [
    'CLASS_11',
    'Class 11 Commerce',
    'Complete Class 11 Commerce batch (Commerce only); alone or with CLAT, IPMAT or CUET (owner, 20–21 Oct 2026).',
    'active',
  ],
  [
    'CLASS_12',
    'Class 12 Commerce',
    'Complete Class 12 Commerce batch (Commerce only); alone or with CLAT, IPMAT, CUET or CA Foundation (owner, 20–21 Oct 2026).',
    'active',
  ],
  [
    'DROPPER',
    'Dropper',
    'Dropper batch for students who have finished Class 12; always with one exam: CLAT, IPMAT (incl. IIMB UG-AT), CUET or CA Foundation (owner, 21 Oct 2026).',
    'active',
  ],
  [
    'CA_FOUNDATION',
    'CA Foundation',
    'CA Foundation preparation; running now (owner, 21 Oct 2026).',
    'active',
  ],
] as const satisfies readonly (readonly [
  string,
  string,
  string,
  'active' | 'planned' | 'paused' | 'retired',
])[];

/**
 * One SAMPLE user per role (D-036): named "Sample <role>" so nobody mistakes them for
 * real staff; the teacher is the sample Maths teacher (Academic seeds give them Quant).
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
    displayName: 'Sample Platform Admin',
    department: 'TECHNOLOGY_DATA',
    title: 'Platform administrator',
    managerRole: 'director',
  },
  {
    role: 'director',
    email: 'director@example.test',
    displayName: 'Sample Director',
    department: 'LEADERSHIP_OPERATIONS',
    title: 'Director',
    managerRole: null,
  },
  {
    role: 'marketing_manager',
    email: 'marketing-manager@example.test',
    displayName: 'Sample Marketing Manager',
    department: 'MARKETING_GROWTH',
    title: 'Marketing manager',
    managerRole: 'director',
  },
  {
    role: 'marketing_contributor',
    email: 'marketing-contributor@example.test',
    displayName: 'Sample Content Contributor',
    department: 'MARKETING_GROWTH',
    title: 'Content contributor',
    managerRole: 'marketing_manager',
  },
  {
    role: 'academic_coordinator',
    email: 'academic-coordinator@example.test',
    displayName: 'Sample Academic Coordinator',
    department: 'ACADEMICS',
    title: 'Academic coordinator',
    managerRole: 'director',
  },
  {
    role: 'teacher',
    email: 'teacher@example.test',
    displayName: 'Sample Maths Teacher',
    department: 'ACADEMICS',
    title: 'Maths teacher',
    managerRole: 'academic_coordinator',
  },
  {
    role: 'admissions_counsellor',
    email: 'admissions-counsellor@example.test',
    displayName: 'Sample Counsellor',
    department: 'ADMISSIONS_COUNSELLING',
    title: 'Admissions counsellor',
    managerRole: 'operations_manager',
  },
  {
    role: 'operations_manager',
    email: 'operations-manager@example.test',
    displayName: 'Sample Operations Manager',
    department: 'LEADERSHIP_OPERATIONS',
    title: 'Operations manager',
    managerRole: 'director',
  },
  {
    // Brief 23 Oct 2026 §5 (role Proposed): HR for teachers and marketing staff.
    role: 'hr_manager',
    email: 'hr-manager@example.test',
    displayName: 'Sample HR Manager',
    department: 'HUMAN_RESOURCES',
    title: 'HR manager',
    managerRole: 'director',
  },
  {
    role: 'auditor',
    email: 'auditor@example.test',
    displayName: 'Sample Auditor',
    department: null,
    title: null,
    managerRole: null,
  },
];

const departmentsSeed = defineSeed({
  name: 'core.departments',
  module: 'platform',
  description: '13 provisional departments from the legacy architecture note',
  async run({ db }) {
    for (const [code, name, description] of SEED_DEPARTMENTS) {
      await db
        .insert(departments)
        .values({ code, name, description, status: 'provisional' })
        .onConflictDoUpdate({ target: departments.code, set: { name, description } });
    }
  },
});

/**
 * The one centre on record: the Sikar address printed on every document (INSTITUTE in
 * packages/shared-ui/src/components/brand.tsx). `provisional` until the owner confirms the
 * branch list; "Online" is a delivery mode, not a branch. A re-seed never changes its status.
 */
const branchesSeed = defineSeed({
  name: 'core.branches',
  module: 'platform',
  description: 'Sikar centre (provisional; the only branch on record)',
  async run({ db }) {
    await db
      .insert(branches)
      .values({ code: 'SIKAR', name: 'Sikar centre', status: 'provisional' })
      .onConflictDoUpdate({ target: branches.code, set: { name: 'Sikar centre' } });
  },
});

const programmesSeed = defineSeed({
  name: 'core.programmes',
  module: 'platform',
  description:
    'Programme catalogue (CLAT, IPMAT, CUET, CLASS_11, CLASS_12, DROPPER, COMMERCE_11_12, CA_FOUNDATION)',
  async run({ db }) {
    for (const [code, name, description, status] of SEED_PROGRAMMES) {
      await db
        .insert(programmes)
        .values({ code, name, description, status })
        .onConflictDoUpdate({ target: programmes.code, set: { name, description, status } });
    }
  },
});

const usersSeed = defineSeed({
  name: 'core.users',
  module: 'platform',
  description: 'One sample user per role ("Sample <role>", @example.test) with SEED_USER_PASSWORD',
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
  departmentsSeed,
  branchesSeed,
  programmesSeed,
  usersSeed,
  staffSeed,
];
