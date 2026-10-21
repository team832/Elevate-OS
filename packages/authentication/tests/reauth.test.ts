import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import type { UserId } from '@elevate/shared-types';
import { hashPassword, verifyCurrentUserPassword } from '../src/index';

const PASSWORD = 'test-only-reauth-password-1';
let t: TestDatabase;
let db: Database;
let n = 0;

// A fresh user per test: the reauth throttle is module-level and keyed by user id.
async function user(values: { hash?: boolean; status?: 'active' | 'disabled' } = {}) {
  const [u] = await db
    .insert(users)
    .values({
      email: `reauth.${++n}@example.test`,
      displayName: `Sample Approver ${n}`,
      passwordHash: values.hash === false ? null : await hashPassword(PASSWORD),
      status: values.status ?? 'active',
    })
    .returning();
  return u!.id;
}

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());

describe('verifyCurrentUserPassword (D-041)', () => {
  it.each([
    ['right password', {}, PASSWORD, { ok: true, method: 'password' }],
    ['wrong password', {}, 'test-only-wrong', { ok: false, reason: 'wrong_password' }],
    ['no hash (Google-only)', { hash: false }, PASSWORD, { ok: false, reason: 'no_password' }],
    ['disabled user', { status: 'disabled' as const }, PASSWORD, { ok: false, reason: 'inactive' }],
    [
      'disabled Google-only user',
      { hash: false, status: 'disabled' as const },
      PASSWORD,
      { ok: false, reason: 'inactive' },
    ],
  ])('%s', async (_name, values, password, expected) => {
    const result = await verifyCurrentUserPassword(db, await user(values), password);
    expect(result).toMatchObject(expected);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('unknown user id → inactive', async () => {
    const result = await verifyCurrentUserPassword(
      db,
      '00000000-0000-4000-8000-000000000000' as UserId,
      PASSWORD,
    );
    expect(result).toMatchObject({ ok: false, reason: 'inactive' });
  });

  it('5 wrong passwords lock the user, even for the right password next', async () => {
    const id = await user();
    const reasons = [];
    for (let i = 0; i < 5; i++)
      reasons.push(
        ((await verifyCurrentUserPassword(db, id, 'test-only-wrong')) as { reason: string }).reason,
      );
    expect(reasons).toEqual([...Array(4).fill('wrong_password'), 'locked']);
    const next = await verifyCurrentUserPassword(db, id, PASSWORD);
    expect(next).toMatchObject({ ok: false, reason: 'locked' });
    expect(next.ok === false && next.retryAfterMs).toBeGreaterThan(0);
  });

  it('a success resets the failure count', async () => {
    const id = await user();
    for (let i = 0; i < 4; i++) await verifyCurrentUserPassword(db, id, 'test-only-wrong');
    expect((await verifyCurrentUserPassword(db, id, PASSWORD)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await verifyCurrentUserPassword(db, id, 'test-only-wrong');
    expect((await verifyCurrentUserPassword(db, id, PASSWORD)).ok).toBe(true);
  });
});
