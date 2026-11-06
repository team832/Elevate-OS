import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAttempts, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import { LoginThrottle, purgeExpiredLoginAttempts } from '../src/index';

const EMAIL = 'tara.teacher@example.test';
const IP = '203.0.113.7';
const NOW = Date.UTC(2026, 10, 6, 10, 0, 0);
const MIN = 60_000;
let t: TestDatabase;
let db: Database;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());
beforeEach(() => db.delete(loginAttempts));

// The owner's numbers (D-119): each bucket locks for 15 min after `limit` failures in 15 min.
describe.each([
  ['login', 5, `${EMAIL}|${IP}`],
  ['login-ip', 50, IP],
  ['login-email', 20, EMAIL],
  ['google-ip', 50, IP],
  ['reauth', 5, '00000000-0000-4000-8000-000000000001'],
  // Portal (F4-13), Proposed: portal-only buckets, per-login setup and the global ceilings.
  ['portal', 5, `asha.1001@portal.invalid|${IP}`],
  ['portal-ip', 50, IP],
  ['portal-login', 20, 'asha.1001@portal.invalid'],
  ['portal-setup', 5, 'asha.1001'],
  ['portal-all', 500, 'all'],
  ['portal-setup-all', 200, 'all'],
  ['website-form-all', 300, 'all'],
] as const)('%s bucket, limit %i', (bucket, limit, key) => {
  const fail = async (throttle: LoginThrottle, times: number, at = NOW) => {
    const counted = [];
    for (let i = 0; i < times; i++) counted.push(await throttle.recordFailure(db, key, at));
    return counted;
  };

  it('counts failures from two separate throttles (every app and process) and locks at the limit', async () => {
    const [here, there] = [new LoginThrottle(bucket), new LoginThrottle(bucket)];
    expect(await fail(here, limit - 1)).not.toContain(false);
    expect(await there.retryAfterMs(db, key, NOW)).toBe(0);
    expect(await fail(there, 1)).toEqual([true]);
    expect(await here.retryAfterMs(db, key, NOW + MIN)).toBe(14 * MIN);
    expect(await here.retryAfterMs(db, key, NOW + 15 * MIN)).toBe(0);
    // One past the limit raced past the lock check: reported so the caller refuses it.
    expect(await fail(there, 1)).toEqual([false]);
  });

  it('restarts the count when 15 minutes have passed since the first failure', async () => {
    const throttle = new LoginThrottle(bucket);
    await fail(throttle, limit - 1);
    await fail(throttle, limit - 1, NOW + 15 * MIN + 1);
    expect(await throttle.retryAfterMs(db, key, NOW + 15 * MIN + 1)).toBe(0);
    await fail(throttle, 1, NOW + 15 * MIN + 1);
    expect(await throttle.retryAfterMs(db, key, NOW + 15 * MIN + 1)).toBe(15 * MIN);
  });

  it('undo takes one failure back and lifts the lock; reset forgets the key', async () => {
    const throttle = new LoginThrottle(bucket);
    await fail(throttle, limit);
    await throttle.undo(db, key);
    expect(await throttle.retryAfterMs(db, key, NOW)).toBe(0);
    await fail(throttle, 1);
    expect(await throttle.retryAfterMs(db, key, NOW)).toBe(15 * MIN);
    await throttle.reset(db, key);
    expect(await throttle.retryAfterMs(db, key, NOW)).toBe(0);
    expect(await db.select().from(loginAttempts)).toEqual([]);
    await fail(throttle, 1);
    await throttle.undo(db, key);
    expect(await db.select().from(loginAttempts)).toEqual([]);
  });

  it('stores only an HMAC of "<bucket>|<key>" under SESSION_SECRET, never the email or address', async () => {
    await fail(new LoginThrottle(bucket), 1);
    const rows = await db.select().from(loginAttempts);
    const hmac = createHmac('sha256', process.env.SESSION_SECRET!).update(`${bucket}|${key}`);
    expect(rows.map((r) => r.keyHash)).toEqual([hmac.digest('hex')]);
    expect(JSON.stringify(rows)).not.toMatch(/tara|203\.0\.113|00000000/);
  });
});

it('purge deletes counters whose window and lock are over, and keeps the rest', async () => {
  const [stale, live] = [new LoginThrottle('login'), new LoginThrottle('login-ip')];
  await stale.recordFailure(db, EMAIL, NOW - 16 * MIN);
  await live.recordFailure(db, IP, NOW);
  expect(await purgeExpiredLoginAttempts(db, new Date(NOW))).toBe(1);
  expect(await db.select().from(loginAttempts)).toHaveLength(1);
});

it('refuses to work without SESSION_SECRET (fails closed)', async () => {
  vi.stubEnv('SESSION_SECRET', '');
  try {
    await expect(new LoginThrottle('login').retryAfterMs(db, EMAIL)).rejects.toThrow(
      /SESSION_SECRET/,
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
