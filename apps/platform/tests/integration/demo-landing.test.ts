/**
 * Every demo login lands on a populated view (brief 23 Oct 2026 §4, §25): after `npm run db:seed`
 * and `npm run db:seed-demo-accounts`, each account's STORED roles open its workspace and its main
 * list is not empty, read through the same services the screens use and in the account's own
 * scope. The real teachers see only their real assignments; pending ones have no batch yet.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword, type AuthenticatedUser } from '@elevate/authentication';
import { can, workspacesFor } from '@elevate/authorization';
import { assessmentListQuerySchema } from '@elevate/shared-contracts';
import { staffMembers, userRoles, users, type Database } from '@elevate/database';
import {
  coreSeeds,
  DEMO_ACCOUNTS,
  DEV_ASSUMPTION_ACCOUNTS,
  runSeeds,
  seedDemoAccounts,
  seedDevAssumptionAccounts,
} from '@elevate/database/seed';
import type { RoleKey, SessionId, UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import { seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { feeYear } from '../../../business-ops-os/src/server/fee-year';
import { hrQueue, inHrReach } from '../../../business-ops-os/src/server/hr-requests-read';
import { hrRequestListQuery } from '../../../business-ops-os/src/server/hr-requests-schemas';
import { listLeads } from '../../../business-ops-os/src/server/leads';
import { taskListQuery } from '../../../business-ops-os/src/server/staff-tasks-schemas';
import { listTasks } from '../../../business-ops-os/src/server/task-list';
import { listCalendarItems } from '../../../marketing-os/src/server/calendar-queries';
import { listAssessments } from '../../../academic-os/src/server/services/assessments';
import { listAssessmentsInternal } from '../../../academic-os/src/server/services/assessment-views';
import {
  listAssignments,
  listAssignmentsFor,
} from '../../../academic-os/src/server/services/assignments';

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
      return [Object.values(q.counts).reduce((a, b) => a + b, 0) === 4 ? 4 : 0, await tasksOf(l)];
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

  it.each([
    ['satish@elevateeducation.in', 3],
    ['nikunjbindal@elevateeducation.in', 1],
    ['soma@elevateeducation.in', 1],
    ['tushar@elevateeducation.in', 0],
  ])('%s opens academic with only their real assignments (%i)', async (email, n) => {
    expect(DEV_ASSUMPTION_ACCOUNTS.some((a) => a.email === email)).toBe(true);
    const l = await login(email);
    expect(workspacesFor(l.user)).toContain('academic');
    const rows = await listAssignmentsFor(db(), { staffIds: [l.staffId!] });
    expect(rows).toHaveLength(n);
    // Pending = recorded without a batch: the honest "no batch yet" state, no sample batch.
    for (const r of rows) {
      const row = r as { status: string; batchId: string | null; batchCode?: string | null };
      if (row.status === 'pending') expect(row.batchId).toBeNull();
      expect(row.batchCode ?? '').not.toMatch(/^SAMPLE-/);
    }
    expect((await listAssessments(db(), l.academic as never)).every((a) => !a.isSample)).toBe(true);
  });
});
