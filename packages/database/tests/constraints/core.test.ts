import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FUTURE,
  LATER,
  NOW,
  attempt,
  insert,
  one,
  runCases,
  setup,
  variants,
  type Row,
} from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.t.close());

const user = (o: Row = {}) => ({
  email: 'new@example.test',
  display_name: 'New (fictional)',
  ...o,
});
const session = (o: Row = {}) => ({
  user_id: ctx.ids.user,
  token_hash: 'hash-1',
  expires_at: FUTURE,
  ...o,
});

describe('core.users email domain (D-030)', () => {
  it.each([
    ['owner@elevateeducation.in', 'ok'],
    ['first.last@elevateeducation.in', 'ok'],
    ['x+tag@example.test', 'ok'],
    ['k7m2p9qx@portal.invalid', 'ok'], // F4-13 portal login, refused by every staff way in
    ['a@portal.invalid.evil.com', 'users_email_domain'],
    ['a@sub.portal.invalid', 'users_email_domain'],
    ['a@gmail.com', 'users_email_domain'],
    ['a@elevateeducation.in.evil.com', 'users_email_domain'],
    ['a@sub.elevateeducation.in', 'users_email_domain'],
    ['a@elevateeducationxin', 'users_email_domain'],
    ['a@elevate-education.in', 'users_email_domain'],
    ['a@example.testing', 'users_email_domain'],
    ['a b@example.test', 'users_email_domain'],
    ['@example.test', 'users_email_domain'],
    ['a@@example.test', 'users_email_domain'],
    ['a@example.test\n', 'users_email_domain'],
    ['A@example.test', 'users_email_lowercase'],
  ])('%j → %s', async (email, expected) => {
    expect(await attempt(ctx.pg, 'core.users', user({ email }))).toBe(expected);
  });
});

describe('core rules', () => {
  runCases(
    () => ctx.pg,
    [
      one(
        'email is unique',
        'core.users',
        () => user({ email: 'tester@example.test' }),
        'users_email_key',
      ),
      one(
        'user status is active or disabled',
        'core.users',
        () => user({ status: 'bogus' }),
        'users_status_check',
      ),
      one(
        'a session belongs to an existing user',
        'core.sessions',
        () => session({ user_id: crypto.randomUUID() }),
        'sessions_user_id_users_id_fk',
      ),
      one(
        'a session expires after it is created',
        'core.sessions',
        () => session({ created_at: LATER, expires_at: NOW }),
        'sessions_expiry_after_creation',
      ),
      one(
        'a student needs a name (23502 not-null)',
        'core.students',
        () => ({ full_name: null }),
        '23502',
      ),
    ],
  );

  it('deleting a user deletes its sessions (cascade)', async () => {
    const doomed = await insert(ctx.pg, 'core.users', user({ email: 'doomed@example.test' }));
    await insert(ctx.pg, 'core.sessions', session({ user_id: doomed, token_hash: 'hash-doomed' }));
    await ctx.pg.query('DELETE FROM core.users WHERE id = $1', [doomed]);
    const left = await ctx.pg.query('SELECT 1 FROM core.sessions WHERE user_id = $1', [doomed]);
    expect(left.rows).toHaveLength(0);
  });
});

const loginAttempt = (o: Row = {}) => ({
  key_hash: 'a'.repeat(64),
  failures: 1,
  window_started_at: NOW,
  expires_at: LATER,
  ...o,
});
/** LoginThrottle.recordFailure as one statement: $1 key hash, $2 now, $3 window, $4 lock, $5 limit. */
const RECORD_FAILURE = `
  INSERT INTO core.login_attempts AS a (key_hash, failures, window_started_at, locked_until, expires_at)
  VALUES ($1, 1, $2::timestamptz, CASE WHEN $5::int <= 1 THEN $2::timestamptz + $4::interval END,
          $2::timestamptz + greatest($3::interval, $4::interval))
  ON CONFLICT (key_hash) DO UPDATE SET
    failures = CASE WHEN a.window_started_at + $3::interval < $2::timestamptz THEN 1 ELSE a.failures + 1 END,
    window_started_at = CASE WHEN a.window_started_at + $3::interval < $2::timestamptz
      THEN $2::timestamptz ELSE a.window_started_at END,
    locked_until = CASE WHEN (CASE WHEN a.window_started_at + $3::interval < $2::timestamptz
      THEN 1 ELSE a.failures + 1 END) >= $5::int THEN $2::timestamptz + $4::interval END,
    expires_at = excluded.expires_at
  RETURNING failures, locked_until`;

describe('core.login_attempts (0019, shared sign-in limit)', () => {
  beforeAll(() =>
    insert(ctx.pg, 'core.login_attempts', loginAttempt({ key_hash: 'b'.repeat(64) })),
  );

  runCases(
    () => ctx.pg,
    [
      variants('attempt rows', 'core.login_attempts', loginAttempt, {
        counting: [{}, 'ok'],
        locked: [{ locked_until: LATER }, 'ok'],
        'raw email and ip': [
          { key_hash: 'tester@example.test|127.0.0.1' },
          'login_attempts_key_check',
        ],
        'upper-case hex': [{ key_hash: 'A'.repeat(64) }, 'login_attempts_key_check'],
        'negative count': [{ failures: -1 }, 'login_attempts_failures_check'],
        'lock outlives the row': [{ locked_until: FUTURE }, 'login_attempts_expiry_check'],
        'same key twice': [{ key_hash: 'b'.repeat(64) }, 'login_attempts_pkey'],
      }),
    ],
  );

  it('one upsert counts failures, locks at the limit and restarts after the window', async () => {
    const fail = async (at: string) =>
      (await ctx.pg.query(RECORD_FAILURE, ['c'.repeat(64), at, '15 minutes', '15 minutes', 5]))
        .rows[0];
    for (const failures of [1, 2, 3, 4])
      expect(await fail(NOW)).toEqual({ failures, locked_until: null });
    expect(await fail(NOW)).toEqual({
      failures: 5,
      locked_until: new Date('2026-10-21T04:45:00Z'),
    });
    expect(await fail(LATER)).toEqual({ failures: 1, locked_until: null });
  });
});
