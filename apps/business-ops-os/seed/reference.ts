/**
 * The lead reference seeds (./lead-reference.ts) plus the SAMPLE staff (D-036). Business Ops writes
 * core.staff_members as steward.
 */
import { and, eq, like } from 'drizzle-orm';
import {
  departments,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  COVER_TEACHERS,
  defineSeed,
  SUBJECT_TEACHERS,
  syncStaffHistory,
} from '@elevate/database/seed';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { leadReferenceSeeds } from './lead-reference';

export { leadSourceCode, seedLeadSources } from './lead-reference';

/**
 * SAMPLE staff (D-036): one sample teacher per demo subject and the made-up teachers of the real
 * seven's subjects, without logins, plus the sample login users' staff records (core seed). Every
 * sample profile has `is_sample`; the real teachers (./teachers.ts) are never used for sample events.
 */
export const SAMPLE_TEACHERS = SUBJECT_TEACHERS;
/** The sample teacher login (core seed `teacher@example.test`) teaches Mathematics. */
export const SAMPLE_LOGIN_TEACHER = {
  email: 'teacher@example.test',
  subject: 'Mathematics',
} as const;
const SAMPLE_SOURCE = 'Sample data (D-036) — not a real person';

const ROLE_LABELS_BY_EMAIL: Record<string, string[]> = {
  'director@example.test': ['Main authority'],
  'operations-manager@example.test': ['Operations Lead'],
  'admissions-counsellor@example.test': ['Admissions Coordinator', 'Academic Counsellor'],
  'academic-coordinator@example.test': ['Academic Coordinator'],
  'teacher@example.test': ['Faculty'],
  'marketing-manager@example.test': ['Marketing Lead'],
};

async function sampleProfile(db: Database, staffId: StaffMemberId, roleLabels: string[]) {
  const set = { roleLabels, isSample: true, sourceNote: SAMPLE_SOURCE };
  await db
    .insert(opsStaffProfiles)
    .values({ staffId, ...set })
    .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set });
}

async function sampleCapability(db: Database, staffId: StaffMemberId, subject: string) {
  await db
    .insert(opsStaffSubjectCapabilities)
    .values({ staffId, subject, sourceNote: SAMPLE_SOURCE })
    .onConflictDoNothing();
}

/** One teacher, found by name among sample staff only: a real person with that name is someone else. */
async function ensureSampleTeacher(
  db: Database,
  t: { fullName: string; title: string; subjects: readonly string[] },
  placed: { departmentId: DepartmentId | null; managerId: StaffMemberId | null },
) {
  const [existing] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .innerJoin(
      opsStaffProfiles,
      and(eq(opsStaffProfiles.staffId, staffMembers.id), eq(opsStaffProfiles.isSample, true)),
    )
    .where(eq(staffMembers.fullName, t.fullName));
  const id =
    existing?.id ??
    (
      await db
        .insert(staffMembers)
        .values({ fullName: t.fullName, title: t.title, ...placed })
        .returning({ id: staffMembers.id })
    )[0]!.id;
  await sampleProfile(db, id, ['Faculty']);
  for (const subject of t.subjects) await sampleCapability(db, id, subject);
  return id;
}

export async function seedStaff(db: Database) {
  const [academics] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'ACADEMICS'));
  const [coordinator] = await db
    .select({ id: staffMembers.id, userId: users.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.email, 'academic-coordinator@example.test'));
  const placed = { departmentId: academics?.id ?? null, managerId: coordinator?.id ?? null };
  const ids: StaffMemberId[] = [];
  for (const t of [
    ...SAMPLE_TEACHERS.map(([fullName, subject]) => ({
      fullName,
      title: `${subject} teacher`,
      subjects: [subject],
    })),
    ...COVER_TEACHERS,
  ])
    ids.push(await ensureSampleTeacher(db, t, placed));
  if (coordinator) await syncStaffHistory(db, ids, coordinator.userId);
  const linked = await db
    .select({ id: staffMembers.id, email: users.email })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(like(users.email, '%@example.test'));
  for (const row of linked) {
    await sampleProfile(db, row.id, ROLE_LABELS_BY_EMAIL[row.email] ?? []);
    if (row.email === SAMPLE_LOGIN_TEACHER.email)
      await sampleCapability(db, row.id, SAMPLE_LOGIN_TEACHER.subject);
  }
}

export const referenceSeeds = [
  ...leadReferenceSeeds,
  defineSeed({
    name: 'ops.staff',
    module: 'ops',
    dependsOn: ['core.staff_members'],
    description: `${SAMPLE_TEACHERS.length + COVER_TEACHERS.length} sample teachers (no login) + sample profiles for the seed users`,
    run: ({ db }) => seedStaff(db),
  }),
];
