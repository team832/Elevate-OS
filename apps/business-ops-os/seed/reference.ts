/**
 * Reference data: the configurable lead-source list (OPS-002, from the legacy
 * CRM Import dropdown) and Ops staff profiles. Extra staff are FICTIONAL
 * (D-016) and have no login. Business Ops writes core.staff_members as steward.
 */
import { and, eq, inArray } from 'drizzle-orm';
import workflows from '../../../data/legacy/ops/workflows.json';
import {
  departments,
  opsLeadSources,
  opsStaffProfiles,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';

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

/** Fictional staff without logins (reception and a backup counsellor), plus role labels for seed users. */
export const FICTIONAL_STAFF = [
  {
    fullName: 'Rhea Reception (fictional)',
    title: 'Reception',
    department: 'ADMISSIONS_COUNSELLING',
    managerEmail: 'operations-manager@example.test',
    roleLabels: ['Reception'],
  },
  {
    fullName: 'Bina Backup Counsellor (fictional)',
    title: 'Academic counsellor',
    department: 'ADMISSIONS_COUNSELLING',
    managerEmail: 'operations-manager@example.test',
    roleLabels: ['Academic Counsellor'],
  },
] as const;

const ROLE_LABELS_BY_EMAIL: Record<string, string[]> = {
  'director@example.test': ['Main authority'],
  'operations-manager@example.test': ['Operations Lead'],
  'admissions-counsellor@example.test': ['Admissions Coordinator', 'Academic Counsellor'],
  'academic-coordinator@example.test': ['Academic Coordinator'],
  'teacher@example.test': ['Faculty'],
  'marketing-manager@example.test': ['Marketing Lead'],
};

export async function seedStaff(db: Database) {
  const deptRows = await db
    .select({ id: departments.id, code: departments.code })
    .from(departments);
  const dept = new Map(deptRows.map((d) => [d.code, d.id]));
  for (const s of FICTIONAL_STAFF) {
    const [manager] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(eq(users.email, s.managerEmail));
    const values = {
      fullName: s.fullName,
      title: s.title,
      departmentId: dept.get(s.department) ?? null,
      managerId: manager?.id ?? null,
    };
    const [existing] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.fullName, s.fullName));
    const id = existing
      ? (
          await db
            .update(staffMembers)
            .set(values)
            .where(eq(staffMembers.id, existing.id))
            .returning({ id: staffMembers.id })
        )[0]?.id
      : (await db.insert(staffMembers).values(values).returning({ id: staffMembers.id }))[0]?.id;
    if (id) {
      await db
        .insert(opsStaffProfiles)
        .values({ staffId: id, roleLabels: [...s.roleLabels] })
        .onConflictDoUpdate({
          target: opsStaffProfiles.staffId,
          set: { roleLabels: [...s.roleLabels] },
        });
    }
  }
  const linked = await db
    .select({ id: staffMembers.id, email: users.email })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(inArray(users.email, Object.keys(ROLE_LABELS_BY_EMAIL))));
  for (const row of linked) {
    const roleLabels = ROLE_LABELS_BY_EMAIL[row.email] ?? [];
    await db
      .insert(opsStaffProfiles)
      .values({ staffId: row.id, roleLabels })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: { roleLabels } });
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
    description: '2 fictional staff without logins + role labels (steward of core.staff_members)',
    run: ({ db }) => seedStaff(db),
  }),
];
