/**
 * Reference data: the configurable lead-source list (OPS-002, from the legacy
 * CRM Import dropdown) and the SAMPLE staff (D-036). Business Ops writes
 * core.staff_members as steward.
 */
import { eq, like } from 'drizzle-orm';
import workflows from '../../../data/legacy/ops/workflows.json';
import {
  departments,
  opsLeadSources,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { StaffMemberId } from '@elevate/shared-types';

/** Legacy label → stable code. "Unknown" stays its own source (BR-OPS-5). */
export function leadSourceCode(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function seedLeadSources(db: Database) {
  const labels = (workflows as { lead_sources: { crm_first_enquiry_source_dropdown: string[] } })
    .lead_sources.crm_first_enquiry_source_dropdown;
  let sortOrder = 0;
  for (const label of labels) {
    sortOrder += 10;
    const code = leadSourceCode(label);
    await db
      .insert(opsLeadSources)
      .values({ code, label, sortOrder })
      .onConflictDoUpdate({ target: opsLeadSources.code, set: { label, sortOrder } });
  }
}

/**
 * SAMPLE staff (D-036): one sample teacher per demo subject, without logins, plus the
 * sample login users' staff records (core seed). Every sample profile has `is_sample`;
 * the owner-supplied real teachers (./teachers.ts) are never used for sample events.
 */
export const SAMPLE_TEACHERS = [
  ['Sample English Teacher', 'English'],
  ['Sample Legal Reasoning Teacher', 'Legal Reasoning'],
  ['Sample Logical Reasoning Teacher', 'Logical Reasoning'],
  ['Sample Current Affairs Teacher', 'Current Affairs'],
  ['Sample Economics Teacher', 'Economics'],
  ['Sample Accountancy Teacher', 'Accountancy'],
] as const;
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

export async function seedStaff(db: Database) {
  const [academics] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'ACADEMICS'));
  const [coordinator] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.email, 'academic-coordinator@example.test'));
  for (const [fullName, subject] of SAMPLE_TEACHERS) {
    const [existing] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.fullName, fullName));
    const id =
      existing?.id ??
      (
        await db
          .insert(staffMembers)
          .values({
            fullName,
            title: `${subject} teacher`,
            departmentId: academics?.id ?? null,
            managerId: coordinator?.id ?? null,
          })
          .returning({ id: staffMembers.id })
      )[0]!.id;
    await sampleProfile(db, id, ['Faculty']);
    await sampleCapability(db, id, subject);
  }
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
  defineSeed({
    name: 'ops.lead-sources',
    module: 'ops',
    description:
      '12 lead sources from the legacy CRM Import dropdown (Unknown kept as its own source)',
    run: ({ db }) => seedLeadSources(db),
  }),
  defineSeed({
    name: 'ops.staff',
    module: 'ops',
    dependsOn: ['core.staff_members'],
    description: `${SAMPLE_TEACHERS.length} sample teachers (one per subject, no login) + sample profiles for the seed users`,
    run: ({ db }) => seedStaff(db),
  }),
];
