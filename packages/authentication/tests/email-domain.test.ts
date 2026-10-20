import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import {
  ORGANISATION_EMAIL_DOMAIN,
  assertAllowedEmail,
  createLoginHandler,
  createSession,
  hashPassword,
  isAllowedEmail,
  validateSession,
} from '../src/index';

const SECRET = 'test-only-session-secret-0123456789-abcdefghij';
let t: TestDatabase;
let db: Database;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());
afterEach(() => vi.unstubAllEnvs());

describe('D-030: only @elevateeducation.in accounts', () => {
  it.each([
    ['priya@elevateeducation.in', 'production', true],
    ['  Priya@ElevateEducation.IN ', 'production', true],
    ['someone@gmail.com', 'production', false],
    ['a@sub.elevateeducation.in', 'production', false],
    ['a@elevateeducation.in.evil.com', 'production', false],
    ['elevateeducation.in', 'production', false],
    ['@elevateeducation.in', 'production', false],
    ['a@b@elevateeducation.in', 'production', false],
    ['tara@example.test', 'production', false],
    ['tara@example.test', 'development', true],
    ['tara@example.test', 'test', true],
    ['someone@gmail.com', 'development', false],
  ])('%s in %s → %s', (email, env, allowed) => {
    expect(isAllowedEmail(email, env)).toBe(allowed);
  });

  it('assertAllowedEmail names the organisation domain', () => {
    expect(() => assertAllowedEmail('x@gmail.com', 'production')).toThrow(
      `@${ORGANISATION_EMAIL_DOMAIN}`,
    );
  });

  it('password sign-in refuses an outside email with 403 before any lookup', async () => {
    const login = createLoginHandler({
      module: 'platform',
      loginPath: '/login',
      defaultRedirect: '/',
      getDb: () => db,
      getSecret: () => SECRET,
    });
    const res = await login(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'someone@gmail.com', password: 'whatever-password' }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('@elevateeducation.in');
  });

  it('in production a fictional @example.test session is never valid', async () => {
    const [u] = await db
      .insert(users)
      .values({
        email: 'fiona.fictional@example.test',
        displayName: 'Fiona (fictional)',
        passwordHash: await hashPassword('fictional-password-2'),
      })
      .returning();
    const { token } = await createSession(db, { userId: u!.id, secret: SECRET });
    expect(await validateSession(db, token, SECRET)).not.toBeNull();
    vi.stubEnv('NODE_ENV', 'production');
    expect(await validateSession(db, token, SECRET)).toBeNull();
  });

  it('the database refuses any other domain (users_email_domain)', async () => {
    await expect(
      db.insert(users).values({ email: 'someone@gmail.com', displayName: 'Outsider (fictional)' }),
    ).rejects.toThrow();
  });
});
