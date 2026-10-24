import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { departments, opsStaffProfiles, staffMembers, userRoles, users } from '../src/index';
import {
  DEMO_ACCOUNTS,
  DEMO_EMAILS,
  MARKETING_EMPLOYEES,
  assertDemoSeedAllowed,
  disableDemoAccounts,
  ensureDemoStaff,
  seedDemoAccounts,
} from '../src/seed';
import { createTestDb, type TestDatabase } from '../src/testing';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(departments).values(
    ['LEADERSHIP_OPERATIONS', 'ACADEMICS', 'MARKETING_GROWTH', 'HUMAN_RESOURCES'].map((code) => ({
      code,
      name: code,
    })),
  );
});
afterAll(() => t.close());

describe('demo account seed guard (D-072)', () => {
  const ok = { nodeEnv: 'development', databaseIsLocal: true, password: 'test-only-demo-password' };
  it.each([
    ['production', { ...ok, nodeEnv: 'production' }, /production/],
    ['a remote database', { ...ok, databaseIsLocal: false }, /not a local database/],
    ['no password', { ...ok, password: undefined }, /LOCAL_DEMO_PASSWORD/],
    ['a short password', { ...ok, password: 'short' }, /LOCAL_DEMO_PASSWORD/],
    [
      'the .env.example placeholder',
      { ...ok, password: 'replace-with-a-dev-only-password' },
      /LOCAL_DEMO_PASSWORD/,
    ],
  ])('refuses %s', (_name, input, message) => {
    expect(() => assertDemoSeedAllowed(input)).toThrow(message);
  });
  it('allows a local development run', () => {
    expect(() => assertDemoSeedAllowed(ok)).not.toThrow();
  });
});

describe('seedDemoAccounts', () => {
  it('db:seed makes the marketing employees without a password and never takes a foreign email', async () => {
    const [manager] = await t.db.insert(staffMembers).values({ fullName: 'Manager' }).returning();
    await t.db
      .insert(users)
      .values({ email: MARKETING_EMPLOYEES[1].email, displayName: 'Real Person' });
    const made = await ensureDemoStaff(t.db, MARKETING_EMPLOYEES, manager!.id);
    expect([...made.keys()]).toEqual([MARKETING_EMPLOYEES[0].email]);
    const { staffId, userId } = made.get(MARKETING_EMPLOYEES[0].email)!;
    const [user] = await t.db.select().from(users).where(eq(users.id, userId));
    expect(user!.passwordHash).toBeNull();
    const [staff] = await t.db.select().from(staffMembers).where(eq(staffMembers.id, staffId));
    expect(staff).toMatchObject({ managerId: manager!.id, fullName: 'Sample Pooja Verma' });
    const [profile] = await t.db
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, staffId));
    expect(profile!.isSample).toBe(true);
    await t.db.delete(users).where(eq(users.email, MARKETING_EMPLOYEES[1].email));
  });

  it('creates every demo account with its stored role and staff record, and is repeatable', async () => {
    // The business account made under its old name is still ours (renamed, not refused).
    await t.db
      .insert(users)
      .values({ email: 'business@elevateeducation.in', displayName: 'Sample Business Demo' });
    await seedDemoAccounts(t.db, 'test-only-hash-1');
    await seedDemoAccounts(t.db, 'test-only-hash-2');
    const rows = await t.db
      .select()
      .from(users)
      .where(inArray(users.email, [...DEMO_EMAILS]));
    expect(rows).toHaveLength(DEMO_ACCOUNTS.length);
    expect(new Set(rows.map((r) => r.passwordHash))).toEqual(new Set(['test-only-hash-2']));
    for (const a of DEMO_ACCOUNTS) {
      const user = rows.find((r) => r.email === a.email)!;
      const roles = await t.db.select().from(userRoles).where(eq(userRoles.userId, user.id));
      expect(roles.map((r) => r.role)).toEqual([a.role]);
      const staff = await t.db.select().from(staffMembers).where(eq(staffMembers.userId, user.id));
      expect(staff).toHaveLength(1);
      expect(user.displayName).toBe(a.displayName);
      expect(user.displayName).toMatch(/^Sample |\(demo\)$/);
    }
  });

  it('db:clear-samples switches them off: no password, disabled', async () => {
    expect(await disableDemoAccounts(t.db)).toBe(DEMO_ACCOUNTS.length);
    const rows = await t.db
      .select()
      .from(users)
      .where(inArray(users.email, [...DEMO_EMAILS]));
    expect(rows.every((r) => r.status === 'disabled' && r.passwordHash === null)).toBe(true);
    const staff = await t.db
      .select()
      .from(staffMembers)
      .where(
        inArray(
          staffMembers.userId,
          rows.map((r) => r.id),
        ),
      );
    expect(staff.every((s) => s.status === 'inactive')).toBe(true);
  });

  it('never takes over a real account that uses one of the demo emails', async () => {
    await t.db
      .update(users)
      .set({ displayName: 'Real Person', passwordHash: 'test-only-real-hash' })
      .where(eq(users.email, 'marketing@elevateeducation.in'));
    await expect(seedDemoAccounts(t.db, 'test-only-hash-3')).rejects.toThrow(
      /marketing@elevateeducation\.in already belong/,
    );
    const [real] = await t.db
      .select()
      .from(users)
      .where(eq(users.email, 'marketing@elevateeducation.in'));
    expect(real?.passwordHash).toBe('test-only-real-hash');
  });
});
