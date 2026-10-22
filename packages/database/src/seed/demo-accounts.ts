import { eq, inArray } from 'drizzle-orm';
import type { RoleKey } from '@elevate/shared-types';
import type { Database } from '../client';
import { departments, staffMembers, userRoles, users } from '../schema/core';

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

/**
 * Create or refresh the demo accounts, their role and staff record. Safe to run again.
 * Refuses (before writing anything) when one of the emails belongs to an account this seed did
 * not create, so a real person's password is never replaced.
 */
export async function seedDemoAccounts(db: Database, passwordHash: string): Promise<void> {
  const existing = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(inArray(users.email, [...DEMO_EMAILS]));
  const foreign = existing.filter(
    (u) => u.displayName !== DEMO_ACCOUNTS.find((a) => a.email === u.email)?.displayName,
  );
  if (foreign.length)
    throw new Error(
      `refusing: ${foreign.map((u) => u.email).join(', ')} already belong to another account.`,
    );
  const deptRows = await db
    .select({ id: departments.id, code: departments.code })
    .from(departments);
  const deptByCode = new Map(deptRows.map((d) => [d.code, d.id]));
  for (const a of DEMO_ACCOUNTS) {
    const [user] = await db
      .insert(users)
      .values({ email: a.email, displayName: a.displayName, passwordHash, status: 'active' })
      .onConflictDoUpdate({
        target: users.email,
        set: { displayName: a.displayName, passwordHash, status: 'active' },
      })
      .returning({ id: users.id });
    await db.insert(userRoles).values({ userId: user!.id, role: a.role }).onConflictDoNothing();
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
    else await db.insert(staffMembers).values({ ...staff, userId: user!.id });
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
  return rows.length;
}
