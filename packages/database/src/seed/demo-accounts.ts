import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import type { Database } from '../client';
import {
  departments,
  notifications,
  sessions,
  staffMembers,
  userRoles,
  users,
} from '../schema/core';
import { opsStaffProfiles } from '../schema/ops';
import { COVER_TEACHERS, FORMER_DEV_LOGINS, PEOPLE } from './sample-people';
import { syncStaffHistory } from './staff-history';

/**
 * Local demo sign-ins (D-072; brief 23 Oct 2026 §4/§25: business administrator = operations
 * manager, HR manager, marketing manager, two fictional marketing employees, one teacher, plus the
 * fictional Schar).
 * Development only: they share one password (LOCAL_DEMO_PASSWORD), so `assertDemoSeedAllowed` refuses production and any non-local
 * database, and `db:clear-samples` switches them off. The email only identifies the account;
 * what it may open comes from the role stored here.
 */
interface DemoAccount {
  email: string;
  displayName: string;
  /** Names this seed used before for the same account (still ours, so never refused as foreign). */
  formerNames?: readonly string[];
  role: RoleKey;
  department: string;
  title: string;
  /** Demo account this one reports to (set by db:seed-demo-accounts, so that manager's views show the team). */
  managerEmail?: string;
}

/**
 * The two fictional marketing employees (brief 23 Oct 2026 §25): @example.test, marketing
 * contributors in Marketing & Growth. `npm run db:seed` creates their records WITHOUT a password
 * (`ensureDemoStaff`) so sample leads and tasks can belong to them; `db:seed-demo-accounts` gives
 * them LOCAL_DEMO_PASSWORD like every other demo account.
 */
export const MARKETING_EMPLOYEES = [
  {
    email: 'pooja.verma@example.test',
    displayName: PEOPLE.pooja,
    formerNames: ['Sample Pooja Verma'],
    role: 'marketing_contributor',
    department: 'MARKETING_GROWTH',
    title: 'Marketing executive',
    managerEmail: 'marketing@elevateeducation.in',
  },
  {
    email: 'rohit.saini@example.test',
    displayName: PEOPLE.rohit,
    formerNames: ['Sample Rohit Saini'],
    role: 'marketing_contributor',
    department: 'MARKETING_GROWTH',
    title: 'Marketing executive',
    managerEmail: 'marketing@elevateeducation.in',
  },
] as const satisfies readonly DemoAccount[];

/** Sample-set helpers shared by the module seeds: the employees' emails, their sample manager. */
export const [POOJA_EMAIL, ROHIT_EMAIL] = MARKETING_EMPLOYEES.map((e) => e.email) as [
  string,
  string,
];
export const SAMPLE_MARKETING_MANAGER_EMAIL = 'marketing-manager@example.test';
/** Free text written by a seed, one sentence. */
export const sampleText = (s: string) => `${s}.`;

/**
 * The fictional person the sample set names as Schar (setting hr.request_recipients, D-096), so a
 * forward to Schar can be tried end to end. The owner still names the real person; db:clear-samples
 * puts the setting back to unset. The role is the narrowest that can answer a forwarded request.
 */
export const SAMPLE_SCHAR = {
  email: 'schar.mathur@elevateeducation.in',
  displayName: PEOPLE.schar,
  role: 'admissions_counsellor',
  department: 'LEADERSHIP_OPERATIONS',
  title: 'Executive assistant',
} as const satisfies DemoAccount;

export const DEMO_ACCOUNTS = [
  {
    email: 'business@elevateeducation.in',
    displayName: PEOPLE.businessLogin,
    formerNames: ['Sample Business Demo', 'Business administrator (demo)'],
    role: 'operations_manager',
    department: 'LEADERSHIP_OPERATIONS',
    title: 'Business administrator',
  },
  {
    email: 'hr@elevateeducation.in',
    displayName: PEOPLE.hrLogin,
    formerNames: ['HR manager (demo)'],
    role: 'hr_manager',
    department: 'HUMAN_RESOURCES',
    title: 'HR manager',
  },
  {
    email: 'teacher@elevateeducation.in',
    displayName: PEOPLE.teacherLogin,
    formerNames: ['Sample Teacher Demo'],
    role: 'teacher',
    department: 'ACADEMICS',
    title: 'Quant teacher',
  },
  {
    email: 'marketing@elevateeducation.in',
    displayName: PEOPLE.marketingLogin,
    formerNames: ['Sample Marketing Demo'],
    role: 'marketing_manager',
    department: 'MARKETING_GROWTH',
    title: 'Marketing manager',
  },
  ...MARKETING_EMPLOYEES,
  SAMPLE_SCHAR,
] as const satisfies readonly DemoAccount[];

export const DEMO_EMAILS: readonly string[] = DEMO_ACCOUNTS.map((a) => a.email);

/**
 * Development assumptions (brief 23 Oct 2026 §4, rulings R10 and PLAN): four teacher logins for
 * local testing only, each linked to a made-up teacher (COVER_TEACHERS, owner 31 Oct 2026: "made up
 * everything"), with the teacher role and the same guards as the demo accounts. Addresses are
 * written out here because the release preflight reads them from this file. No real person is linked.
 * Teaching assignments come from Academic's sample seed, never from the email. `db:clear-samples`
 * disables these logins.
 */
const devAccount = (email: string, staffFullName: string) => ({
  email,
  displayName: staffFullName,
  role: 'teacher' as const,
  staffFullName,
});
const coverName = (subject: string) =>
  COVER_TEACHERS.find((t) => (t.subjects as readonly string[]).includes(subject))!.fullName;

export const DEV_ASSUMPTION_ACCOUNTS = [
  devAccount('kunal.vyas@elevateeducation.in', coverName('Class 11 Mathematics')),
  devAccount('lata.krishnan@elevateeducation.in', coverName('CLAT Current Affairs')),
  devAccount('ramesh.chandak@elevateeducation.in', coverName('CUET Accountancy')),
  devAccount(
    'siddharth.rao@elevateeducation.in',
    coverName('IPM / IIM Bangalore-oriented programmes'),
  ),
];

const DEV_EMAILS: readonly string[] = DEV_ASSUMPTION_ACCOUNTS.map((a) => a.email);
/** Only as an older seed named them: a real person's own account at that address is left alone. */
const FORMER_DEV = and(
  inArray(users.email, FORMER_DEV_LOGINS),
  like(users.displayName, '%(development assumption%'),
);

/** Throws unless this is a development run against a local database with a usable password. */
export function assertDemoSeedAllowed(input: {
  nodeEnv: string | undefined;
  databaseIsLocal: boolean;
  password: string | undefined;
}): asserts input is { nodeEnv: string | undefined; databaseIsLocal: true; password: string } {
  if (input.nodeEnv === 'production') throw new Error('refusing: NODE_ENV=production.');
  if (!input.databaseIsLocal) throw new Error('refusing: DATABASE_URL is not a local database.');
  if (!input.password || input.password.length < 12 || /^replace-with/i.test(input.password))
    throw new Error('set LOCAL_DEMO_PASSWORD (at least 12 characters) in the root .env.');
}

type Named = { email: string; displayName: string; formerNames?: readonly string[] };

const REMOVED_LOGIN = 'Removed sample login';
const REMOVED_STAFF = 'Removed sample staff';

/** Emails among `accounts` held by an account this seed did not create. */
async function foreignEmails(db: Database, accounts: readonly Named[]) {
  const existing = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(
      inArray(
        users.email,
        accounts.map((a) => a.email),
      ),
    );
  return existing
    .filter((u) => {
      const a = accounts.find((x) => x.email === u.email)!;
      return (
        !u.displayName.startsWith(REMOVED_LOGIN) &&
        ![a.displayName, ...(a.formerNames ?? [])].includes(u.displayName)
      );
    })
    .map((u) => u.email);
}

/** Refuse when an account with one of these emails was not made by this seed. */
async function refuseForeign(db: Database, accounts: readonly Named[]) {
  const foreign = await foreignEmails(db, accounts);
  if (foreign.length)
    throw new Error(`refusing: ${foreign.join(', ')} already belong to another account.`);
}

/**
 * Upsert an account with its seeded role; returns its id. With a password hash: active with that
 * password. Without (db:seed): a new account has no password and an existing one keeps its own.
 */
async function upsertAccount(
  db: Database,
  a: { email: string; displayName: string; role: RoleKey },
  passwordHash?: string,
) {
  const [user] = await db
    .insert(users)
    .values({
      email: a.email,
      displayName: a.displayName,
      passwordHash: passwordHash ?? null,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: users.email,
      set: passwordHash
        ? { displayName: a.displayName, passwordHash, status: 'active' }
        : { displayName: a.displayName },
    })
    .returning({ id: users.id });
  await db.insert(userRoles).values({ userId: user!.id, role: a.role }).onConflictDoNothing();
  return user!.id;
}

/** One demo account, its role and its active staff record; returns both ids. */
async function upsertDemo(db: Database, a: DemoAccount, passwordHash?: string) {
  const userId = await upsertAccount(db, a, passwordHash);
  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, a.department));
  const staff = {
    fullName: a.displayName,
    departmentId: dept?.id ?? null,
    title: a.title,
    status: 'active' as const,
  };
  const [existing] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId));
  if (existing) await db.update(staffMembers).set(staff).where(eq(staffMembers.id, existing.id));
  const staffId =
    existing?.id ??
    (
      await db
        .insert(staffMembers)
        .values({ ...staff, userId })
        .returning()
    )[0]!.id;
  await syncStaffHistory(db, [staffId], userId);
  return { userId: userId as UserId, staffId: staffId as StaffMemberId };
}

/**
 * Create or refresh the demo accounts, their role and staff record. Safe to run again.
 * Refuses (before writing anything) when one of the emails belongs to an account this seed did
 * not create, so a real person's password is never replaced.
 */
export async function seedDemoAccounts(db: Database, passwordHash: string): Promise<void> {
  await refuseForeign(db, DEMO_ACCOUNTS);
  const ids = new Map<string, Awaited<ReturnType<typeof upsertDemo>>>();
  for (const a of DEMO_ACCOUNTS) ids.set(a.email, await upsertDemo(db, a, passwordHash));
  // The marketing employees report to the demo marketing manager, so that login sees its team.
  for (const a of DEMO_ACCOUNTS.filter((x) => 'managerEmail' in x)) {
    const { staffId, userId } = ids.get(a.email)!;
    await db
      .update(staffMembers)
      .set({ managerId: ids.get(a.managerEmail!)!.staffId })
      .where(eq(staffMembers.id, staffId));
    await syncStaffHistory(db, [staffId], userId);
  }
}

/**
 * For `npm run db:seed`: the demo staff that sample records belong to, WITHOUT setting a password
 * (sign-in comes from `db:seed-demo-accounts`), reporting to `managerStaffId`, with a sample staff
 * profile. An email held by someone else's account is skipped, never taken over.
 * Returns email → ids of the accounts that are ours.
 */
export async function ensureDemoStaff(
  db: Database,
  accounts: readonly DemoAccount[],
  managerStaffId: StaffMemberId | null,
) {
  const foreign = new Set(await foreignEmails(db, accounts));
  const out = new Map<string, Awaited<ReturnType<typeof upsertDemo>>>();
  for (const a of accounts.filter((x) => !foreign.has(x.email))) {
    const ids = await upsertDemo(db, a);
    // Keep an active manager already set (db:seed-demo-accounts links the demo manager).
    const [{ managerId } = { managerId: null }] = await db
      .select({ managerId: staffMembers.managerId })
      .from(staffMembers)
      .where(eq(staffMembers.id, ids.staffId));
    const [current] = managerId
      ? await db
          .select({ status: staffMembers.status })
          .from(staffMembers)
          .where(eq(staffMembers.id, managerId))
      : [];
    if (current?.status !== 'active') {
      await db
        .update(staffMembers)
        .set({ managerId: managerStaffId })
        .where(eq(staffMembers.id, ids.staffId));
      await syncStaffHistory(db, [ids.staffId], ids.userId);
    }
    const profile = { isSample: true, sourceNote: 'SAMPLE DATA: fictional demo staff' };
    await db
      .insert(opsStaffProfiles)
      .values({ staffId: ids.staffId, ...profile })
      .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: profile });
    out.set(a.email, ids);
  }
  return out;
}

/**
 * Create or refresh the development-assumption accounts and link each to its staff record.
 * Refuses (before writing) a foreign account with the email, a missing staff record (run
 * `npm run db:seed` first) or a staff record already linked to another login.
 */
export async function seedDevAssumptionAccounts(db: Database, passwordHash: string): Promise<void> {
  await refuseForeign(db, DEV_ASSUMPTION_ACCOUNTS);
  const staff = await db
    .select({
      id: staffMembers.id,
      fullName: staffMembers.fullName,
      userId: users.id,
      email: users.email,
    })
    .from(staffMembers)
    .leftJoin(users, eq(users.id, staffMembers.userId))
    .where(
      inArray(
        staffMembers.fullName,
        DEV_ASSUMPTION_ACCOUNTS.map((a) => a.staffFullName),
      ),
    );
  for (const a of DEV_ASSUMPTION_ACCOUNTS) {
    const s = staff.filter((x) => x.fullName === a.staffFullName);
    if (s.length !== 1)
      throw new Error(
        `refusing: expected one staff record "${a.staffFullName}"; run npm run db:seed first.`,
      );
    if (s[0]!.email && s[0]!.email !== a.email)
      throw new Error(`refusing: ${a.staffFullName} is already linked to another login.`);
  }
  for (const a of DEV_ASSUMPTION_ACCOUNTS) {
    const userId = await upsertAccount(db, a, passwordHash);
    // An older database linked this login to a real person: that record stays, without the login.
    await db.update(staffMembers).set({ userId: null }).where(eq(staffMembers.userId, userId));
    await db
      .update(staffMembers)
      .set({ userId })
      .where(eq(staffMembers.id, staff.find((x) => x.fullName === a.staffFullName)!.id));
  }
}

/**
 * Switch the demo accounts off (no password, disabled) and their staff records inactive, so
 * nobody can pick them as an owner; their history stays. Returns how many accounts.
 */
export async function disableDemoAccounts(db: Database): Promise<number> {
  const rows = await db
    .update(users)
    .set({ status: 'disabled', passwordHash: null })
    .where(or(inArray(users.email, [...DEMO_EMAILS, ...DEV_EMAILS]), FORMER_DEV))
    .returning({ id: users.id });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  // A real person still linked by an older database loses the login and stays as they are.
  const real = sql`${staffMembers.id} NOT IN (SELECT ${opsStaffProfiles.staffId} FROM ${opsStaffProfiles} WHERE ${opsStaffProfiles.isSample})`;
  await db
    .update(staffMembers)
    .set({ userId: null })
    .where(and(inArray(staffMembers.userId, ids), real));
  await db
    .update(staffMembers)
    .set({ status: 'inactive' })
    .where(inArray(staffMembers.userId, ids));
  return rows.length;
}

/**
 * The last step of `db:clear-samples`. Sample logins and their staff records stay because other
 * records point at them, but a normal English name in Users & roles would read as a real employee:
 * each now reads as removed, cannot sign in and has no open session or notice. @example.test is never a real
 * account (D-030). Running `db:seed` again restores them. Returns how many logins.
 */
export async function retireSampleLogins(db: Database): Promise<number> {
  await disableDemoAccounts(db);
  const sampleStaff = sql`SELECT ${opsStaffProfiles.staffId} FROM ${opsStaffProfiles} WHERE ${opsStaffProfiles.isSample}`;
  const retired = await db
    .update(users)
    .set({
      displayName: sql`${REMOVED_LOGIN} || ' ' || left(${users.id}::text, 6)`,
      status: 'disabled',
      passwordHash: null,
    })
    .where(
      or(
        like(users.email, '%@example.test'),
        inArray(users.email, [...DEMO_EMAILS, ...DEV_EMAILS]),
        FORMER_DEV,
        sql`${users.id} IN (SELECT ${staffMembers.userId} FROM ${staffMembers} WHERE ${staffMembers.id} IN (${sampleStaff}))`,
      ),
    )
    .returning({ id: users.id });
  const ids = retired.map((r) => r.id);
  await db.delete(sessions).where(inArray(sessions.userId, ids));
  // Nobody can read these any more, and they repeat made-up names.
  await db.delete(notifications).where(inArray(notifications.userId, ids));
  await db
    .update(staffMembers)
    .set({
      fullName: sql`${REMOVED_STAFF} || ' ' || left(${staffMembers.id}::text, 6)`,
      title: null,
      status: 'inactive',
    })
    .where(or(sql`${staffMembers.id} IN (${sampleStaff})`, inArray(staffMembers.userId, ids)));
  await db
    .update(opsStaffProfiles)
    .set({ displayName: null })
    .where(eq(opsStaffProfiles.isSample, true));
  return retired.length;
}
