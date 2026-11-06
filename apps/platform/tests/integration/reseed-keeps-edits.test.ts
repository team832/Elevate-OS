/**
 * SCR-002: running the seeds again never changes what a person edited, on `npm run db:seed` and on
 * the production reference seed. Every seeded table with an editable field is edited, the seeds run
 * again, and each value is read back. Sample rows are not covered: a re-seed may restore those.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  academicBatches,
  academicCalendarExclusions,
  academicCalendarRules,
  academicChapters,
  academicConceptBookChapters,
  academicCourses,
  academicCurriculumPlans,
  academicPlanItems,
  academicSubjects,
  branches,
  departments,
  marketingContentRules,
  marketingOptimisationCategories,
  marketingPolicySettings,
  marketingSocialAccounts,
  opsFeeStructures,
  opsLeadSources,
  opsLeadStages,
  opsOnboardingTemplates,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  programmes,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, runSeeds, type SeedDefinition } from '@elevate/database/seed';
import { hashPassword } from '@elevate/authentication';
import type { UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import { seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { referenceSeedList } from '../../../../scripts/release/reference-seeds';
import { updateStaff, updateTeacher } from '@elevate/business-ops-os/server';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const DB_SEED: SeedDefinition[] = [
  ...coreSeeds,
  ...marketingSeeds,
  ...academicSeeds,
  ...opsSeeds,
  ...platformSeeds,
];
const seedEverything = () => runSeeds(db(), DB_SEED, context);

/** Rows of a seeded table, by subquery so a row is named by its natural key. */
const firstOf = (from: string, where = 'true') =>
  sql.raw(`id = (SELECT id FROM ${from} WHERE ${where} ORDER BY 1 LIMIT 1)`);
const IPMAT = `course_id = (SELECT id FROM academic.courses WHERE code = 'IPMAT-BASE')`;
const CAF_PLAN = `plan_id = (SELECT id FROM academic.curriculum_plans WHERE code = 'CAF-ACC-V0.2')`;

type Row = readonly [string, Parameters<ReturnType<Database['select']>['from']>[0], SQL | undefined, Record<string, unknown>];

const EDITS: readonly Row[] = [
  ['core.departments', departments, eq(departments.code, 'FINANCE'), { name: 'Edited', description: 'Edited', status: 'active' }],
  ['core.branches', branches, eq(branches.code, 'SIKAR'), { name: 'Edited' }],
  ['core.programmes', programmes, eq(programmes.code, 'COMMERCE_11_12'), { name: 'Edited', description: 'Edited', status: 'retired' }],
  ['ops.lead_sources', opsLeadSources, firstOf('ops.lead_sources', `code <> 'UNKNOWN'`), { label: 'Edited', sortOrder: 999, status: 'retired' }],
  ['ops.lead_stages', opsLeadStages, firstOf('ops.lead_stages'), { label: 'Edited' }],
  ['ops.staff_profiles', opsStaffProfiles, sql`${opsStaffProfiles.staffId} = (SELECT id FROM core.staff_members WHERE full_name = 'Satish Raghuvanshi')`, { displayName: 'Edited', roleNote: 'Edited', notes: 'Edited', verificationStatus: 'unverified' }],
  ['ops.onboarding_templates', opsOnboardingTemplates, eq(opsOnboardingTemplates.code, 'proposed_standard'), { status: 'retired' }],
  ['ops.fee_structures (website price)', opsFeeStructures, firstOf('ops.fee_structures', `source = 'website_stated'`), { label: 'Edited', amountPaise: 999 }],
  ['academic.batches', academicBatches, eq(academicBatches.code, 'CAF-SEP27-REG'), { name: 'Edited', status: 'completed' }],
  ['academic.courses', academicCourses, eq(academicCourses.code, 'CLAT-SYL-2027'), { name: 'Edited', description: 'Edited' }],
  ['academic.subjects', academicSubjects, firstOf('academic.subjects', IPMAT), { name: 'Edited', sortOrder: 99 }],
  ['academic.chapters', academicChapters, firstOf('academic.chapters', IPMAT), { title: 'Edited', sortOrder: 999, weight: 7 }],
  ['academic.curriculum_plans', academicCurriculumPlans, eq(academicCurriculumPlans.code, 'CAF-ACC-V0.2'), { status: 'superseded', changeLog: 'Edited' }],
  ['academic.plan_items', academicPlanItems, firstOf('academic.plan_items', CAF_PLAN), { coverage: 'Edited', plannedMinutes: 99 }],
  ['academic.calendar_rules', academicCalendarRules, firstOf('academic.calendar_rules'), { slotsPerDay: 3 }],
  ['academic.calendar_exclusions', academicCalendarExclusions, firstOf('academic.calendar_exclusions', 'days IS NOT NULL'), { days: 9 }],
  ['academic.concept_book_chapters', academicConceptBookChapters, eq(academicConceptBookChapters.chapterCode, 'B4-10'), { title: 'Edited', bookTitle: 'Edited' }],
  ['marketing.optimisation_categories', marketingOptimisationCategories, eq(marketingOptimisationCategories.key, 'seo'), { label: 'Edited', active: false }],
  ['marketing.social_accounts', marketingSocialAccounts, firstOf('marketing.social_accounts'), { handle: 'edited-handle' }],
  ['marketing.content_rules', marketingContentRules, firstOf('marketing.content_rules'), { description: 'Edited' }],
  ['marketing.policy_settings', marketingPolicySettings, firstOf('marketing.policy_settings'), { description: 'Edited' }],
];

const read = async (table: Row[1], where: Row[2]) =>
  (await db().select().from(table).where(where)) as Record<string, unknown>[];

const staffId = async (fullName: string) =>
  (await db().select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.fullName, fullName)))[0]?.id;

const subjectsOf = async (fullName: string) =>
  (
    await db()
      .select({ subject: opsStaffSubjectCapabilities.subject })
      .from(opsStaffSubjectCapabilities)
      .where(eq(opsStaffSubjectCapabilities.staffId, (await staffId(fullName))!))
  )
    .map((r) => r.subject)
    .sort();

const rows = <T>(result: T) =>
  ((result as { rows?: unknown[] }).rows ?? result) as Record<string, unknown>[];

/** Every row of every table, for "this run changed nothing at all". */
async function everyRow() {
  const tables = rows(
    await db().execute(sql`SELECT table_schema AS s, table_name AS t FROM information_schema.tables
      WHERE table_schema IN ('core','ops','academic','marketing') AND table_type = 'BASE TABLE' ORDER BY 1, 2`),
  );
  const out: Record<string, unknown> = {};
  for (const { s, t } of tables)
    out[`${s as string}.${t as string}`] = rows(
      await db().execute(sql.raw(`SELECT * FROM "${s as string}"."${t as string}" ORDER BY 1`)),
    );
  return out;
}

describe('running the seeds again', () => {
  beforeAll(async () => {
    await seedEverything();
    // db:seed never writes a reference-only seed; the rows it needs a real manager for are in place.
    await runSeeds(db(), referenceSeedList(['owner-staff', 'marketing-history']), context);
    for (const [name, table, where, edit] of EDITS) {
      const edited = (await db().update(table as never).set(edit as never).where(where).returning()) as unknown[];
      if (edited.length !== 1) throw new Error(`${name}: expected one row to edit, got ${edited.length}`);
    }
  }, 280_000);

  describe('npm run db:seed', () => {
    beforeAll(async () => {
      await seedEverything();
    }, 280_000);

    it.each(EDITS)('keeps the edit on %s', async (_name, table, where, edit) => {
      const [row] = await read(table, where);
      expect(row).toMatchObject(edit);
    });
  });

  describe('the reference seed', () => {
    it('changes nothing at all on a database with real data', async () => {
      const before = await everyRow();
      // Not marketing-history: its code counters are floors that only rise, by design.
      await runSeeds(db(), referenceSeedList(['owner-staff']), context);
      const after = await everyRow();
      const changed = Object.keys(before).filter(
        (table) => JSON.stringify(before[table]) !== JSON.stringify(after[table]),
      );
      expect(changed).toEqual([]);
    }, 120_000);
  });

  describe('real teachers', () => {
    const list = referenceSeedList(['owner-staff']);
    const reseed = () => runSeeds(db(), list, context);
    const manager = async () => {
      const [m] = await db()
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .where(and(eq(userRoles.role, 'operations_manager'), eq(users.email, 'operations-manager@example.test')));
      return { id: m!.id as UserId, roles: ['operations_manager' as const] };
    };

    it('keeps the subjects a person set: no removed subject comes back, no added one goes', async () => {
      const id = (await staffId('Nikunj Bindal'))!;
      await updateTeacher(db(), await manager(), id, { subjects: ['CUET Accountancy', 'Mathematics'] } as never);
      await reseed();
      expect(await subjectsOf('Nikunj Bindal')).toEqual(['CUET Accountancy', 'Mathematics']);
    });

    it('still removes a retired subject the seed itself wrote on a teacher nobody has edited', async () => {
      const id = (await staffId('Soma Tiwari'))!;
      await db().insert(opsStaffSubjectCapabilities).values({ staffId: id, subject: 'Current Affairs' });
      await reseed();
      expect(await subjectsOf('Soma Tiwari')).not.toContain('Current Affairs');
    });

    it('does not make a second person when a teacher was renamed on screen', async () => {
      const id = (await staffId('Tushar Bhakte'))!;
      await updateStaff(db(), await manager(), id, { fullName: 'Tushar Bhakte Renamed' } as never);
      await reseed();
      const found = await db()
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(inArray(staffMembers.fullName, ['Tushar Bhakte', 'Tushar Bhakte Renamed']));
      expect(found.map((r) => r.id)).toEqual([id]);
    });
  });
});
