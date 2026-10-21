import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FUTURE, LATER, NOW, attempt, insert, one, runCases, setup, type Row } from './helpers';

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
