import { eq, inArray } from 'drizzle-orm';
import type { RoleKey } from '@elevate/shared-types';
import type { Database } from '../client';
import { departments, staffMembers, userRoles, users } from '../schema/core';
import { syncStaffHistory } from './staff-history';

/**
 * Local demo sign-ins, one per workspace (D-072). Development only: they share one password
 * (LOCAL_DEMO_PASSWORD), so `assertDemoSeedAllowed` refuses production and any non-local
 * database, and `db:clear-samples` switches them off. The email only identifies the account;
 * what it may open comes from the role stored here.
 */
export const DEMO_ACCOUNTS = [
  {
    email: 'business@elevateeducation.in',
    displayName: 'Sample Business Demo',
    role: 'operations_manager',
    department: 'LEADERSHIP_OPERATIONS',
  },
  {
    email: 'teacher@elevateeducation.in',
    displayName: 'Sample Teacher Demo',
    role: 'teacher',
    department: 'ACADEMICS',
  },
  {
    email: 'marketing@elevateeducation.in',
    displayName: 'Sample Marketing Demo',
    role: 'marketing_manager',
    department: 'MARKETING_GROWTH',
  },
] as const satisfies readonly {
  email: string;
  displayName: string;
  role: RoleKey;
  department: string;
}[];

export const DEMO_EMAILS: readonly string[] = DEMO_ACCOUNTS.map((a) => a.email);

/**
 * Development assumption (brief 23 Oct 2026 §4, ruling R10): the brief's "satish@elevateeducation"
 * is incomplete, so satish@elevateeducation.in is ASSUMED for local testing only. It is linked to
 * the owner-supplied staff record (seeded by `npm run db:seed`), gets the teacher role and the
 * same guards as the demo accounts. `db:clear-samples` disables it and unlinks it from the staff
 * record, which stays active: it is a real person's record.
 */
export const DEV_ASSUMPTION_ACCOUNTS = [
  {
    email: 'satish@elevateeducation.in',
    displayName: 'Satish Raghuvanshi (development assumption)',
    role: 'teacher',
    staffFullName: 'Satish Raghuvanshi',
  },
] as const satisfies readonly {
  email: string;
  displayName: string;
  role: RoleKey;
  staffFullName: string;
}[];

const DEV_EMAILS: readonly string[] = DEV_ASSUMPTION_ACCOUNTS.map((a) => a.email);

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

/** Refuse when an account with one of these emails was not made by this seed. */
async function refuseForeign(
  db: Database,
  accounts: readonly { email: string; displayName: string }[],
) {
  const existing = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(
      inArray(
        users.email,
        accounts.map((a) => a.email),
      ),
    );
  const foreign = existing.filter(
    (u) => u.displayName !== accounts.find((a) => a.email === u.email)?.displayName,
  );
  if (foreign.length)
    throw new Error(
      `refusing: ${foreign.map((u) => u.email).join(', ')} already belong to another account.`,
    );
}

/** Upsert an account (active, this password) with exactly its seeded role; returns its id. */
async function upsertAccount(
  db: Database,
  a: { email: string; displayName: string; role: RoleKey },
  passwordHash: string,
) {
  const [user] = await db
    .insert(users)
    .values({ email: a.email, displayName: a.displayName, passwordHash, status: 'active' })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName: a.displayName, passwordHash, status: 'active' },
    })
    .returning({ id: users.id });
  await db.insert(userRoles).values({ userId: user!.id, role: a.role }).onConflictDoNothing();
  return user!.id;
}

/**
 * Create or refresh the demo accounts, their role and staff record. Safe to run again.
 * Refuses (before writing anything) when one of the emails belongs to an account this seed did
 * not create, so a real person's password is never replaced.
 */
export async function seedDemoAccounts(db: Database, passwordHash: string): Promise<void> {
  await refuseForeign(db, DEMO_ACCOUNTS);
  const deptRows = await db
    .select({ id: departments.id, code: departments.code })
    .from(departments);
  const deptByCode = new Map(deptRows.map((d) => [d.code, d.id]));
  for (const a of DEMO_ACCOUNTS) {
    const user = { id: await upsertAccount(db, a, passwordHash) };
    const staff = {
      fullName: a.displayName,
      departmentId: deptByCode.get(a.department) ?? null,
      title: 'Demo account',
      status: 'active' as const,
    };
    const [existing] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(eq(staffMembers.userId, user!.id));
    if (existing) await db.update(staffMembers).set(staff).where(eq(staffMembers.id, existing.id));
    const id =
      existing?.id ??
      (await db.insert(staffMembers).values({ ...staff, userId: user.id }).returning())[0]!.id;
    await syncStaffHistory(db, [id], user.id);
  }
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
    .where(inArray(users.email, [...DEMO_EMAILS]))
    .returning({ id: users.id });
  if (rows.length)
    await db
      .update(staffMembers)
      .set({ status: 'inactive' })
      .where(
        inArray(
          staffMembers.userId,
          rows.map((r) => r.id),
        ),
      );
  // Development-assumption logins: off and unlinked; the real staff record stays as it is.
  const dev = await db
    .update(users)
    .set({ status: 'disabled', passwordHash: null })
    .where(inArray(users.email, [...DEV_EMAILS]))
    .returning({ id: users.id });
  if (dev.length)
    await db
      .update(staffMembers)
      .set({ userId: null })
      .where(
        inArray(
          staffMembers.userId,
          dev.map((r) => r.id),
        ),
      );
  return rows.length + dev.length;
}
