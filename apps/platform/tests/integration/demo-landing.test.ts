/**
 * Every demo login lands on a populated view (brief 23 Oct 2026 §4, §25): after `npm run db:seed`
 * and `npm run db:seed-demo-accounts`, each account's STORED roles open its workspace and its main
 * list is not empty, read through the same services the screens use and in the account's own
 * scope. The four teacher logins are made-up teachers and see their own assignments.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { hashPassword, type AuthenticatedUser } from '@elevate/authentication';
import { can, workspacesFor } from '@elevate/authorization';
import { assessmentListQuerySchema } from '@elevate/shared-contracts';
import {
  opsHrRequestEvents,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import {
  COVER_TEACHERS,
  coreSeeds,
  DEMO_ACCOUNTS,
  DEV_ASSUMPTION_ACCOUNTS,
  runSeeds,
  SAMPLE_SCHAR,
  seedDemoAccounts,
  seedDevAssumptionAccounts,
} from '@elevate/database/seed';
import type { RoleKey, SessionId, UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import { seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { OWNER_SUPPLIED_STAFF } from '@elevate/business-ops-os/seed';
import { feeYear, hrQueue, hrRequestListQuery, inHrReach } from '@elevate/business-ops-os/server';
import { listLeads } from '@elevate/business-ops-os/leads';
import { listTasks, taskListQuery } from '@elevate/business-ops-os/work';
import { listCalendarItems } from '@elevate/marketing-os/server';
import {
  listAssessments,
  listAssessmentsInternal,
  listAssignments,
  listAssignmentsFor,
} from '@elevate/academic-os/server';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };

async function login(email: string) {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  const roles = await db()
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u!.id));
  const [staff] = await db().select().from(staffMembers).where(eq(staffMembers.userId, u!.id));
  const user = {
    id: u!.id as UserId,
    email,
    displayName: u!.displayName,
    roles: roles.map((r) => r.role as RoleKey),
    sessionId: 'test' as SessionId,
  } as AuthenticatedUser;
  return { user, academic: { user }, staffId: staff?.id ?? null, passwordHash: u!.passwordHash };
}
type Login = Awaited<ReturnType<typeof login>>;
const tasksOf = async (l: Login) =>
  (await listTasks(db(), l.user, taskListQuery.parse({ tab: 'all' }), 500)).total;

beforeAll(async () => {
  await runSeeds(
    db(),
    [...coreSeeds, ...marketingSeeds, ...academicSeeds, ...opsSeeds, ...platformSeeds],
    context,
  );
  // What `npm run db:seed-demo-accounts` does (with a test hash, never a real password).
  await seedDemoAccounts(db(), 'test-only-demo-hash');
  await seedDevAssumptionAccounts(db(), 'test-only-demo-hash');
}, 600_000);

/** email → landing workspace → what its main view counts (> 0). */
const MAIN_VIEW: [string, string, (l: Login) => Promise<number[]>][] = [
  [
    'business@elevateeducation.in',
    'ops',
    async (l) => [
      (await listLeads(db(), l.user)).length,
      (await feeYear(db(), l.user, {})).rows.length,
      // The Tests section reads Academic's list over the internal route (caller ops): these items.
      can(l.user, 'ops:assessments:read')
        ? (await listAssessmentsInternal(db(), assessmentListQuerySchema.parse({}))).items.length
        : 0,
    ],
  ],
  [
    'hr@elevateeducation.in',
    'ops',
    async (l) => {
      const q = await hrQueue(db(), l.user, hrRequestListQuery.parse({ view: 'queue' }));
      return [Object.values(q.counts).reduce((a, b) => a + b, 0), await tasksOf(l)];
    },
  ],
  [
    'marketing@elevateeducation.in',
    'marketing',
    async (l) => [
      await tasksOf(l), // the team's tasks: the employees report to this account
      (await listLeads(db(), l.user)).length,
      (await listCalendarItems(db(), {})).length,
    ],
  ],
  [
    'teacher@elevateeducation.in',
    'academic',
    async (l) => [
      (await listAssignments(db(), l.academic as never)).length,
      (await listAssessments(db(), l.academic as never)).length,
    ],
  ],
  [
    SAMPLE_SCHAR.email,
    'ops',
    async (l) => [
      await db().$count(opsHrRequestEvents, eq(opsHrRequestEvents.forwardedToStaffId, l.staffId!)),
      await tasksOf(l),
    ],
  ],
  ...['pooja.verma@example.test', 'rohit.saini@example.test'].map(
    (email): [string, string, (l: Login) => Promise<number[]>] => [
      email,
      'marketing',
      async (l) => [
        (await listLeads(db(), l.user)).length,
        await tasksOf(l),
        (await listCalendarItems(db(), { ownerStaffId: l.staffId! })).length,
      ],
    ],
  ),
];

describe('after db:seed-demo-accounts', () => {
  it('no row anywhere, address or name, holds a word of a real teacher’s name', async () => {
    const words = OWNER_SUPPLIED_STAFF.flatMap((t) => t.fullName.split(' ')).filter(
      (w) => w !== "Ma'am",
    );
    const pattern = `(${[...new Set(words)].join('|')})`;
    const rows = async (q: string) =>
      ((await db().execute(sql.raw(q))) as unknown as { rows: Record<string, unknown>[] }).rows;
    expect(
      await rows(
        `SELECT email FROM core.users WHERE email ~* '${pattern}' OR display_name ~* '${pattern}'`,
      ),
    ).toEqual([]);
    const tables = await rows(
      `SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
       WHERE table_schema IN ('core', 'ops', 'academic', 'marketing') AND table_type = 'BASE TABLE'`,
    );
    const found: string[] = [];
    for (const { t } of tables)
      if (
        (await rows(`SELECT 1 FROM ${String(t)} x WHERE x::text ~* '\\m${pattern}\\M' LIMIT 1`))
          .length
      )
        found.push(String(t));
    expect(found).toEqual([]);
  });
});

describe('demo logins land on a populated view', () => {
  it('covers every demo account', () => {
    expect(MAIN_VIEW.map(([e]) => e).sort()).toEqual(DEMO_ACCOUNTS.map((a) => a.email).sort());
  });

  it.each(MAIN_VIEW)('%s opens %s with a non-empty main list', async (email, workspace, counts) => {
    const l = await login(email);
    expect(l.passwordHash).toBe('test-only-demo-hash');
    expect(workspacesFor(l.user)).toContain(workspace);
    for (const n of await counts(l)) expect(n).toBeGreaterThan(0);
  });

  it('HR reaches teachers and marketing staff', async () => {
    const hr = await login('hr@elevateeducation.in');
    for (const email of ['pooja.verma@example.test', 'arjun.menon@example.test'])
      expect(await inHrReach(db(), hr.user, (await login(email)).staffId!)).toBe(true);
  });

  it.each(DEV_ASSUMPTION_ACCOUNTS.map((a) => [a.email, a.staffFullName] as const))(
    '%s opens academic as the made-up teacher %s, with that teacher’s assignments',
    async (email, name) => {
      const l = await login(email);
      expect(workspacesFor(l.user)).toContain('academic');
      expect(l.user.displayName).toBe(name);
      const rows = await listAssignmentsFor(db(), { staffIds: [l.staffId!] });
      expect(rows).toHaveLength(
        COVER_TEACHERS.find((t) => t.fullName === name)!.assignments.length,
      );
    },
  );
});
