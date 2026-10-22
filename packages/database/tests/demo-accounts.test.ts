import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { departments, staffMembers, userRoles, users } from '../src/index';
import {
  DEMO_ACCOUNTS,
  DEMO_EMAILS,
  assertDemoSeedAllowed,
  disableDemoAccounts,
  seedDemoAccounts,
} from '../src/seed';
import { createTestDb, type TestDatabase } from '../src/testing';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(departments).values(
    ['LEADERSHIP_OPERATIONS', 'ACADEMICS', 'MARKETING_GROWTH'].map((code) => ({
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
  it('creates one account per workspace, with role and staff record, and is repeatable', async () => {
    await seedDemoAccounts(t.db, 'test-only-hash-1');
    await seedDemoAccounts(t.db, 'test-only-hash-2');
    const rows = await t.db
      .select()
      .from(users)
      .where(inArray(users.email, [...DEMO_EMAILS]));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.passwordHash))).toEqual(new Set(['test-only-hash-2']));
    for (const a of DEMO_ACCOUNTS) {
      const user = rows.find((r) => r.email === a.email)!;
      const roles = await t.db.select().from(userRoles).where(eq(userRoles.userId, user.id));
      expect(roles.map((r) => r.role)).toEqual([a.role]);
      const staff = await t.db.select().from(staffMembers).where(eq(staffMembers.userId, user.id));
      expect(staff).toHaveLength(1);
      expect(user.displayName).toMatch(/^Sample /);
    }
  });

  it('db:clear-samples switches them off: no password, disabled', async () => {
    expect(await disableDemoAccounts(t.db)).toBe(3);
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
