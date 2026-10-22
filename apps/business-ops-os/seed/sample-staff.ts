/**
 * Twelve SAMPLE teachers and the SAMPLE Academic Manager they report to (owner answer 4,
 * brief 2 §14, D-036). Display names "Sample <name>", sign-in `<first>.<last>@example.test` with
 * SEED_USER_PASSWORD (the core seed users' local mechanism; production refuses @example.test,
 * D-030). No phone or ID numbers. Subjects are fixture associations, not qualifications.
 * DEMO-T12 has no manager on purpose (the "missing manager mapping" case). The seven real
 * teachers (./teachers.ts) are never used. The manager holds `academic_coordinator`: it can
 * review the EODs submitted to it (manager chain, R3) and coordinates the sample batches.
 */
import { eq } from 'drizzle-orm';
import {
  departments,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed, type SeedContext } from '@elevate/database/seed';
import type { DepartmentId, RoleKey, StaffMemberId } from '@elevate/shared-types';
import { isIsoDate, istToday } from '../src/domain/dates';

/**
 * The day the sample work is built around: env SAMPLE_ANCHOR_DATE (YYYY-MM-DD) or today (IST).
 * Academic's seed reads the same variable (apps/academic-os/seed/samples.ts).
 */
export function sampleAnchorDate(): string {
  const set = process.env.SAMPLE_ANCHOR_DATE;
  if (set && !isIsoDate(set)) throw new Error(`SAMPLE_ANCHOR_DATE "${set}" is not YYYY-MM-DD`);
  return set || istToday(new Date());
}

export const SAMPLE_STAFF_LABEL = 'SAMPLE DATA — fictional staff';

/** [staff code, name, subject] (owner answer 4 / brief 2 §14). */
export const SAMPLE_TEACHER_STAFF = [
  ['DEMO-T01', 'Aditi Mehra', 'CA Foundation Accountancy'],
  ['DEMO-T02', 'Karan Bedi', 'Business Laws'],
  ['DEMO-T03', 'Nisha Rao', 'Quantitative Aptitude'],
  ['DEMO-T04', 'Dev Malhotra', 'CLAT Legal Reasoning'],
  ['DEMO-T05', 'Isha Nair', 'English / Verbal Ability'],
  ['DEMO-T06', 'Raghav Sethi', 'Logical Reasoning'],
  ['DEMO-T07', 'Kavya Joshi', 'General Knowledge / Current Affairs'],
  ['DEMO-T08', 'Arjun Menon', 'IPMAT Quantitative Aptitude'],
  ['DEMO-T09', 'Mehul Desai', 'Economics'],
  ['DEMO-T10', 'Tara Kapoor', 'Business Studies'],
  ['DEMO-T11', 'Neel Shah', 'Class 11/12 Accountancy'],
  ['DEMO-T12', 'Sanya Kulkarni', 'CUET General Test'],
] as const;
export type SampleTeacherCode = (typeof SAMPLE_TEACHER_STAFF)[number][0];
export const NO_MANAGER_CODE: SampleTeacherCode = 'DEMO-T12';
export const SAMPLE_MANAGER = {
  email: 'academic-manager@example.test',
  name: 'Sample Academic Manager',
  role: 'academic_coordinator',
} as const;

export const sampleTeacherEmail = (name: string) =>
  `${name.toLowerCase().replace(' ', '.')}@example.test`;

/** A login-holding staff record, upserted on email (user) and user (staff). */
async function upsertLoginStaff(
  db: Database,
  passwordHash: string,
  v: {
    email: string;
    name: string;
    role: RoleKey;
    title: string;
    departmentId: DepartmentId | null;
    managerId: StaffMemberId | null;
  },
) {
  const [user] = await db
    .insert(users)
    .values({ email: v.email, displayName: v.name, passwordHash, status: 'active' })
    .onConflictDoUpdate({ target: users.email, set: { displayName: v.name, passwordHash } })
    .returning({ id: users.id });
  await db.insert(userRoles).values({ userId: user!.id, role: v.role }).onConflictDoNothing();
  const values = {
    userId: user!.id,
    fullName: v.name,
    title: v.title,
    departmentId: v.departmentId,
    managerId: v.managerId,
  };
  const [existing] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, user!.id));
  if (existing) await db.update(staffMembers).set(values).where(eq(staffMembers.id, existing.id));
  const id =
    existing?.id ??
    (await db.insert(staffMembers).values(values).returning({ id: staffMembers.id }))[0]!.id;
  return id;
}

async function sampleProfile(db: Database, staffId: StaffMemberId, staffCode: string | null) {
  const set = {
    roleLabels: ['Faculty'],
    staffCode,
    employmentType: 'full_time' as const,
    isSample: true,
    sourceNote: SAMPLE_STAFF_LABEL,
  };
  await db
    .insert(opsStaffProfiles)
    .values({ staffId, ...set })
    .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set });
}

export async function seedSampleStaff({ db, seedUserPassword, hashPassword, log }: SeedContext) {
  const passwordHash = await hashPassword(seedUserPassword);
  const [academics] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'ACADEMICS'));
  const [director] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.email, 'director@example.test'));
  const departmentId = academics?.id ?? null;
  const managerId = await upsertLoginStaff(db, passwordHash, {
    ...SAMPLE_MANAGER,
    title: 'Academic manager',
    departmentId,
    managerId: director?.id ?? null,
  });
  await sampleProfile(db, managerId, null);
  for (const [code, name, subject] of SAMPLE_TEACHER_STAFF) {
    const staffId = await upsertLoginStaff(db, passwordHash, {
      email: sampleTeacherEmail(name),
      name: `Sample ${name}`,
      role: 'teacher',
      title: `${subject} teacher`,
      departmentId,
      managerId: code === NO_MANAGER_CODE ? null : managerId,
    });
    await sampleProfile(db, staffId, code);
    await db
      .insert(opsStaffSubjectCapabilities)
      .values({ staffId, subject, sourceNote: SAMPLE_STAFF_LABEL })
      .onConflictDoNothing();
  }
  log(`ops.sample-staff: ${SAMPLE_TEACHER_STAFF.length} sample teachers + ${SAMPLE_MANAGER.name}`);
}

export const sampleStaffSeeds = [
  defineSeed({
    name: 'ops.sample-staff',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members', 'ops.staff'],
    description: `${SAMPLE_TEACHER_STAFF.length} sample teachers DEMO-T01…T12 with local sign-in + ${SAMPLE_MANAGER.name}`,
    run: seedSampleStaff,
  }),
];
