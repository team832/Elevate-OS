/**
 * Teachers and staff supplied by the owner on 20 Oct 2026 (brief §12). REAL people:
 * no emails, phones, logins, photos or credentials are stored, and nobody gets a
 * permission. The owner confirmed the names and subject/role assignments the same day;
 * Tushar Bhakte's alumni listing stays an internal, unverified note. Nikunj Bindal teaches
 * Accounts (owner, 21 Oct 2026, D-047); his role stays Head of Business Operations. Owner answer
 * OA-2 (23 Oct 2026): "Soma" (CLAT Current Affairs, name unverified) and "Soma Tiwari" (Economics)
 * are two different people — never merge them. Satish's subjects per brief 23 Oct 2026 §4.
 * `retired` subjects are removed on re-seed (replaced by the owner's newer answer). Idempotent.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  staffMembers,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';

const SOURCE = 'owner-supplied 2026-10-20; names and subjects confirmed by the owner 2026-10-20';

export const OWNER_SUPPLIED_STAFF = [
  {
    fullName: 'Nikunj Bindal',
    title: 'Head of Business Operations',
    roleNote: 'Head of Business Operations',
    subjects: ['Class 11/12 Accountancy', 'CA Foundation Paper 1 (Accounting)', 'CUET Accountancy'],
    sourceNote: `${SOURCE}; Accounts subjects added by the owner 2026-10-21 (D-047)`,
  },
  {
    fullName: 'Satish Raghuvanshi',
    title: 'Teacher',
    subjects: ['Class 11 Mathematics', 'Class 12 Mathematics', 'IPMAT Quantitative Aptitude'],
    retired: ['Mathematics'],
    sourceNote: `${SOURCE}; owner also wrote "Raghuanshi"; elevateeducation.in/ace-batch spells "Raghuvanshi" (checked 2026-10-20)`,
  },
  {
    fullName: 'Sushant Bindal',
    title: 'Teacher',
    roleNote: 'CEO / director of coaching',
    subjects: ['Economics'],
  },
  {
    fullName: "Olivia Ma'am",
    title: 'Teacher',
    subjects: ['English'],
    sourceNote: `${SOURCE}; name as supplied (no surname given)`,
  },
  {
    fullName: 'Tushar Bhakte',
    title: 'Teacher',
    subjects: ['IPM / IIM Bangalore-oriented programmes'],
    notes:
      'Listed as "IIM Bangalore Alumni" on elevateeducation.in (public), seen 2026-10-20. Not a verified credential; do not use in public-facing text.',
  },
  {
    fullName: 'Sobha',
    title: 'Teacher',
    subjects: ['Commerce-oriented / special mathematics'],
    sourceNote: `${SOURCE}; name as supplied (no surname given)`,
  },
  {
    fullName: 'Soma Tiwari',
    title: 'Teacher',
    subjects: ['Economics'],
    retired: ['Current Affairs'],
    sourceNote: `${SOURCE}; subject changed to Economics by the owner 2026-10-23 (OA-2)`,
  },
  {
    fullName: 'Soma',
    title: 'Teacher',
    subjects: ['CLAT Current Affairs'],
    verification: 'unverified',
    sourceNote:
      'owner-supplied 2026-10-23 (OA-2): "Soma ma’am", CLAT Current Affairs; a different person from Soma Tiwari; full name not given',
  },
] as const satisfies readonly {
  fullName: string;
  title: string;
  subjects: readonly string[];
  retired?: readonly string[];
  verification?: 'unverified';
  roleNote?: string;
  sourceNote?: string;
  notes?: string;
}[];

/** Was a subject with no teacher (brief §12) until Nikunj Bindal took Accounts (D-047). */
const NOW_ASSIGNED = 'Accountancy / CA';

export async function seedTeachers(db: Database) {
  for (const t of OWNER_SUPPLIED_STAFF) {
    const [existing] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.fullName, t.fullName));
    const id =
      existing?.id ??
      (
        await db.insert(staffMembers).values({ fullName: t.fullName, title: t.title }).returning()
      )[0]!.id;
    const profile = {
      displayName: t.fullName,
      verificationStatus: 'verification' in t ? t.verification : ('confirmed' as const),
      roleNote: 'roleNote' in t ? t.roleNote : null,
      sourceNote: 'sourceNote' in t ? t.sourceNote : SOURCE,
      notes: 'notes' in t ? t.notes : null,
    };
    await db
      .insert(opsStaffProfiles)
      .values({ staffId: id, ...profile })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: profile });
    for (const subject of t.subjects) {
      const [cap] = await db
        .select({ id: opsStaffSubjectCapabilities.id })
        .from(opsStaffSubjectCapabilities)
        .where(
          and(
            eq(opsStaffSubjectCapabilities.staffId, id),
            eq(opsStaffSubjectCapabilities.subject, subject),
          ),
        );
      if (!cap)
        await db.insert(opsStaffSubjectCapabilities).values({
          staffId: id,
          subject,
          verificationStatus: profile.verificationStatus,
          sourceNote: profile.sourceNote,
        });
    }
    if ('retired' in t)
      await db
        .delete(opsStaffSubjectCapabilities)
        .where(
          and(
            eq(opsStaffSubjectCapabilities.staffId, id),
            inArray(opsStaffSubjectCapabilities.subject, [...t.retired]),
          ),
        );
  }
  await db
    .delete(opsStaffSubjectCapabilities)
    .where(
      and(
        isNull(opsStaffSubjectCapabilities.staffId),
        eq(opsStaffSubjectCapabilities.subject, NOW_ASSIGNED),
      ),
    );
}

export const teacherSeeds = [
  defineSeed({
    name: 'ops.teachers',
    module: 'ops',
    dependsOn: ['core.staff_members'],
    description:
      '8 owner-supplied staff (all teach; Nikunj Bindal also heads Business Ops) with subjects; no contacts, logins or permissions',
    run: ({ db }) => seedTeachers(db),
  }),
];
