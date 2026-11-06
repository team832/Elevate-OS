/**
 * The production reference seed (RELEASE-2, F-06): on an empty database it writes no sample row and
 * no account, a lead can then be created, a second run changes nothing, the rows that need a real
 * manager wait for one, and real staff load only when asked for.
 */
import { describe, expect, it } from 'vitest';
import { count, eq, sql } from 'drizzle-orm';
import {
  academicCourses,
  departments,
  marketingOptimisationCategories,
  marketingSocialAccounts,
  opsFeeStructures,
  opsLeadSources,
  opsLeadStages,
  opsLeads,
  opsOnboardingTemplates,
  opsStaffChecklistTemplates,
  programmes,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { runSeeds } from '@elevate/database/seed';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { referenceSeedList } from '../../../../scripts/release/reference-seeds';
import { OWNER_SUPPLIED_STAFF } from '@elevate/business-ops-os/seed';
import { createLead, createLeadBody } from '@elevate/business-ops-os/server';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const context = {
  seedUserPassword: '',
  hashPassword: () => Promise.reject(new Error('A reference seed must not create a sign-in.')),
};

async function seed(include: string[] = []) {
  const said: string[] = [];
  await runSeeds(db(), referenceSeedList(include), { ...context, log: (m) => said.push(m) });
  return said;
}

const rows = <T>(result: T) =>
  ((result as { rows?: unknown[] }).rows ?? result) as Record<string, unknown>[];

/** Every is_sample column in the four schemas, with how many rows say true. */
async function sampleCounts() {
  const columns = rows(
    await db().execute(sql`SELECT table_schema AS s, table_name AS t FROM information_schema.columns
      WHERE column_name = 'is_sample' AND table_schema IN ('core','ops','academic','marketing')`),
  );
  const out: Record<string, number> = {};
  for (const { s, t } of columns) {
    const [r] = rows(
      await db().execute(
        sql.raw(`SELECT count(*)::int AS n FROM "${s as string}"."${t as string}" WHERE is_sample`),
      ),
    );
    out[`${s as string}.${t as string}`] = r!.n as number;
  }
  return out;
}

/** Row count of every table, to prove a second run changes nothing. */
async function allCounts() {
  const tables = rows(
    await db().execute(sql`SELECT table_schema AS s, table_name AS t FROM information_schema.tables
      WHERE table_schema IN ('core','ops','academic','marketing') AND table_type = 'BASE TABLE'`),
  );
  const out: Record<string, number> = {};
  for (const { s, t } of tables) {
    const [r] = rows(
      await db().execute(sql.raw(`SELECT count(*)::int AS n FROM "${s as string}"."${t as string}"`)),
    );
    out[`${s as string}.${t as string}`] = r!.n as number;
  }
  return out;
}

const total = async (table: Parameters<ReturnType<Database['select']>['from']>[0]) =>
  (await db().select({ n: count() }).from(table))[0]!.n;

async function realUser(email: string, role: RoleKey) {
  const [u] = await db()
    .insert(users)
    .values({ email, displayName: 'Reference seed test person', status: 'active' })
    .returning({ id: users.id });
  await db().insert(userRoles).values({ userId: u!.id, role });
  return { id: u!.id as UserId, roles: [role] };
}

describe('reference seed on an empty database', () => {
  it('writes no sample row, no account and no person; a second run changes nothing', async () => {
    const said = await seed();

    expect(Object.values(await sampleCounts()).every((n) => n === 0)).toBe(true);
    expect(Object.keys(await sampleCounts()).length).toBeGreaterThan(3);
    // The one account: the website form's system user, which nobody can sign in as (F4-15).
    expect(
      (await db().select().from(users)).map((u) => [u.email, u.status, u.passwordHash]),
    ).toEqual([['website-form@elevateeducation.in', 'disabled', null]]);
    expect(await total(userRoles)).toBe(0);
    expect(await total(staffMembers)).toBe(0);
    expect(said.join('\n')).not.toContain('@example.test');

    const before = await allCounts();
    await seed();
    expect(await allCounts()).toEqual(before);
  });

  it.each([
    ['departments', departments, 13],
    ['programmes', programmes, 8],
    ['lead stages', opsLeadStages, 12],
    ['SEO, AIO and GEO categories', marketingOptimisationCategories, 3],
    ['social accounts', marketingSocialAccounts, 10],
  ])('loads %s', async (_label, table, want) => {
    expect(await total(table)).toBe(want);
  });

  it.each([
    ['lead sources', opsLeadSources],
    ['courses', academicCourses],
  ])('loads %s', async (_label, table) => {
    expect(await total(table)).toBeGreaterThan(0);
  });

  it('says the manager-owned rows waited, and loads them once a real manager exists', async () => {
    expect(await total(opsOnboardingTemplates)).toBe(0);
    expect(await total(opsFeeStructures)).toBe(0);
    const said = await seed();
    expect(await total(opsStaffChecklistTemplates)).toBe(0);
    expect(said.filter((m) => m.includes('no operations manager yet'))).toHaveLength(3);

    await realUser('reference-manager@elevateeducation.in', 'operations_manager');
    await seed();
    expect(await total(opsOnboardingTemplates)).toBe(1);
    expect(await total(opsStaffChecklistTemplates)).toBe(2); // joining + leaving, version 1
    const fees = await db().select().from(opsFeeStructures);
    expect(fees.map((f) => [f.source, f.status, f.isSample])).toEqual([
      ['website_stated', 'draft', false],
      ['website_stated', 'draft', false],
    ]);
    await seed();
    expect(await total(opsFeeStructures)).toBe(2);
  });

  it('lets a lead be created', async () => {
    const actor = await realUser('reference-counsellor@elevateeducation.in', 'operations_manager');
    const [source] = await db().select().from(opsLeadSources).limit(1);
    await createLead(
      db(),
      actor,
      createLeadBody.parse({
        studentName: 'Reference Test Enquiry',
        studentEmail: 'reference.enquiry@example.test',
        sourceCode: source!.code,
        programmeCode: 'CLAT',
      }),
    );
    const leads = await db().select().from(opsLeads);
    expect(leads.map((l) => [l.studentName, l.isSample])).toEqual([
      ['Reference Test Enquiry', false],
    ]);
  });
});

describe('optional seeds', () => {
  it('loads real staff only when asked, with no sample link', async () => {
    expect(await total(staffMembers)).toBe(0);
    await seed(['owner-staff']);
    const staff = await db().select().from(staffMembers);
    // Exactly the real list: no made-up person ever comes through this door.
    expect(staff.map((s) => s.fullName).sort()).toEqual(
      OWNER_SUPPLIED_STAFF.map((s) => s.fullName).sort(),
    );
    expect(staff.every((s) => s.userId === null)).toBe(true);
    expect(Object.values(await sampleCounts()).every((n) => n === 0)).toBe(true);
    const [satish] = await db()
      .select({ n: count() })
      .from(staffMembers)
      .where(eq(staffMembers.fullName, 'Satish Raghuvanshi'));
    expect(satish!.n).toBe(1);
  });

  it('refuses a name that is not on the list', () => {
    expect(() => referenceSeedList(['samples'])).toThrow(/Unknown --include "samples"/);
  });
});
