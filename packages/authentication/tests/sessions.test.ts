import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditEvents,
  loginAttempts,
  sessions,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import type { UserId } from '@elevate/shared-types';
import {
  LoginThrottle,
  SESSION_COOKIE,
  clearSessionCookie,
  createLoginHandler,
  createLogoutHandler,
  createSession,
  hashPassword,
  hashSessionToken,
  parseCookieHeader,
  revokeAllSessionsForUser,
  revokeSessionByToken,
  serializeCookie,
  sessionCookieOptions,
  validateSession,
} from '../src/index';

const SECRET = 'test-only-session-secret-0123456789-abcdefghij';
let t: TestDatabase;
let db: Database;
let userId: UserId;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  const [u] = await db
    .insert(users)
    .values({
      email: 'tara.teacher@example.test',
      displayName: 'Tara Teacher (fictional)',
      passwordHash: await hashPassword('fictional-password-1'),
    })
    .returning();
  userId = u!.id;
  await db.insert(userRoles).values({ userId, role: 'teacher' });
});
afterAll(() => t.close());

describe('sessions', () => {
  it('creates a session storing only a hash of the token', async () => {
    const { token, sessionId } = await createSession(db, { userId, secret: SECRET });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row?.tokenHash).toBe(hashSessionToken(token, SECRET));
    expect(row?.tokenHash).not.toContain(token);
    const user = await validateSession(db, token, SECRET);
    expect(user).toMatchObject({
      id: userId,
      roles: ['teacher'],
      email: 'tara.teacher@example.test',
    });
  });

  it('rejects unknown tokens and tokens checked with another secret', async () => {
    const { token } = await createSession(db, { userId, secret: SECRET });
    expect(await validateSession(db, 'nope', SECRET)).toBeNull();
    expect(await validateSession(db, token, 'another-secret-another-secret-another')).toBeNull();
    expect(await validateSession(db, undefined, SECRET)).toBeNull();
  });

  it('expires', async () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const { token } = await createSession(db, { userId, secret: SECRET, ttlMs: 60_000, now });
    expect(
      await validateSession(db, token, SECRET, new Date(now.getTime() + 59_000)),
    ).not.toBeNull();
    expect(await validateSession(db, token, SECRET, new Date(now.getTime() + 60_000))).toBeNull();
  });

  it('can be revoked individually or all at once', async () => {
    const a = await createSession(db, { userId, secret: SECRET });
    const b = await createSession(db, { userId, secret: SECRET });
    expect(await revokeSessionByToken(db, a.token, SECRET)).toBe(a.sessionId);
    expect(await revokeSessionByToken(db, a.token, SECRET)).toBeNull();
    expect(await validateSession(db, a.token, SECRET)).toBeNull();
    expect(await validateSession(db, b.token, SECRET)).not.toBeNull();
    expect(await revokeAllSessionsForUser(db, userId)).toBeGreaterThanOrEqual(1);
    expect(await validateSession(db, b.token, SECRET)).toBeNull();
  });

  it('stops working when the user is disabled', async () => {
    const { token } = await createSession(db, { userId, secret: SECRET });
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, userId));
    expect(await validateSession(db, token, SECRET)).toBeNull();
    await db.update(users).set({ status: 'active' }).where(eq(users.id, userId));
  });
});

describe('cookie', () => {
  it('is HttpOnly, SameSite=Lax, path /, Secure only in production', () => {
    const dev = serializeCookie(SESSION_COOKIE, 'abc', sessionCookieOptions(60, 'development'));
    expect(dev).toBe('elevate_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Lax');
    // Named here, not read from PLATFORM_URL in the environment, which may be plain http.
    const prod = serializeCookie(
      SESSION_COOKIE,
      'abc',
      sessionCookieOptions(60, 'production', 'https://ops.example.test'),
    );
    expect(prod).toContain('; Secure');
    expect(clearSessionCookie('development')).toContain('Max-Age=0');
    // Office Wi-Fi mode (D-110): plain http address → no Secure, or browsers drop the cookie.
    expect(sessionCookieOptions(60, 'production', 'http://192.168.1.5:3003').secure).toBe(false);
    expect(sessionCookieOptions(60, 'production', 'https://ops.example.test').secure).toBe(true);
    expect(parseCookieHeader('a=1; elevate_session=xyz; b=2').get(SESSION_COOKIE)).toBe('xyz');
  });
});

describe('login / logout handlers', () => {
  // The limits are shared through the database: each test starts with no counted failures.
  beforeEach(() => db.delete(loginAttempts));
  const options = {
    module: 'platform' as const,
    loginPath: '/login',
    defaultRedirect: '/',
    getDb: () => db,
    getSecret: () => SECRET,
  };

  const jsonLogin = (handler: (r: Request) => Promise<Response>, body: unknown) =>
    handler(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('JSON login sets the cookie and returns the user envelope; audit recorded', async () => {
    const login = createLoginHandler(options);
    const res = await jsonLogin(login, {
      email: 'Tara.Teacher@example.test',
      password: 'fictional-password-1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { roles: string[] } } };
    expect(body.data.user.roles).toEqual(['teacher']);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(
      /^elevate_session=[\w-]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax/,
    );
    const token = parseCookieHeader(cookie.split(';')[0]).get(SESSION_COOKIE)!;
    expect(await validateSession(db, token, SECRET)).not.toBeNull();
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.action, 'auth.login'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('wrong password → 401 UNAUTHENTICATED with a generic message', async () => {
    const res = await jsonLogin(createLoginHandler(options), {
      email: 'tara.teacher@example.test',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Email or password is incorrect.');
    expect(body.error.requestId).toBeTruthy();
    const unknown = await jsonLogin(createLoginHandler(options), {
      email: 'nobody@example.test',
      password: 'wrong-password',
    });
    expect(((await unknown.json()) as { error: { message: string } }).error.message).toBe(
      'Email or password is incorrect.',
    );
  });

  it('missing fields → 400 VALIDATION_FAILED', async () => {
    const res = await jsonLogin(createLoginHandler(options), { email: 'x' });
    expect(res.status).toBe(400);
  });

  it('throttles repeated failures → 429 RATE_LIMITED, even with the right password', async () => {
    const login = createLoginHandler({
      ...options,
      throttle: new LoginThrottle('login', 3),
    });
    for (let i = 0; i < 3; i++) {
      expect(
        (await jsonLogin(login, { email: 'tara.teacher@example.test', password: 'nope-nope' }))
          .status,
      ).toBe(401);
    }
    const locked = await jsonLogin(login, {
      email: 'tara.teacher@example.test',
      password: 'fictional-password-1',
    });
    expect(locked.status).toBe(429);
  });

  it('a new X-Forwarded-For per attempt does not escape the per-email limit', async () => {
    const login = createLoginHandler({
      ...options,
      emailThrottle: new LoginThrottle('login-email', 3),
    });
    const attempt = (i: number, password: string) =>
      login(
        new Request('http://localhost/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i}` },
          body: JSON.stringify({ email: 'tara.teacher@example.test', password }),
        }),
      );
    for (let i = 0; i < 3; i++) expect((await attempt(i, 'nope-nope')).status).toBe(401);
    expect((await attempt(9, 'fictional-password-1')).status).toBe(429);
  });

  it.each([
    ['a NUL in the email, JSON', 'application/json', JSON.stringify({ email: 'a\0b@example.test', password: 'x' }), 400, null],
    ['a NUL in the email, form', 'application/x-www-form-urlencoded', 'email=a%00b%40example.test&password=x', 303, 'error=missing'],
    ['a broken form body', 'multipart/form-data', 'x', 303, 'error=missing'],
  ])('%s is refused, not a 500 (API-001, API-003)', async (_name, type, body, status, location) => {
    const res = await createLoginHandler(options)(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
    );
    expect(res.status).toBe(status);
    if (location) expect(res.headers.get('location')).toContain(location);
  });

  describe('guesses sent at the same moment (API-007)', () => {
    const limited = (max = 5) =>
      createLoginHandler({
        ...options,
        throttle: new LoginThrottle('login', max),
        ipThrottle: new LoginThrottle('login-ip', max * 10),
        emailThrottle: new LoginThrottle('login-email', max * 4),
      });
    const attempt = (login: (r: Request) => Promise<Response>, password: string) =>
      jsonLogin(login, { email: 'tara.teacher@example.test', password }).then((r) => r.status);
    const WRONG = 'nope-nope';
    const RIGHT = 'fictional-password-1';

    it('60 wrong at once: only the limit reach the password check', async () => {
      const login = limited();
      const statuses = await Promise.all(Array.from({ length: 60 }, () => attempt(login, WRONG)));
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(55);
    });

    it('the right password behind 39 wrong ones in one burst is refused', async () => {
      const login = limited();
      const guesses = [...Array.from({ length: 39 }, () => WRONG), RIGHT];
      const statuses = await Promise.all(guesses.map((p) => attempt(login, p)));
      expect(statuses.at(-1)).toBe(429);
      expect(statuses).not.toContain(200);
    });

    it('someone under the limit still gets in, with a wrong guess in flight', async () => {
      const login = limited();
      expect(await Promise.all([attempt(login, WRONG), attempt(login, RIGHT)])).toEqual([401, 200]);
    });

    it('correct sign-ins never use up the limit of a shared address', async () => {
      const login = createLoginHandler({
        ...options,
        ipThrottle: new LoginThrottle('login-ip', 3),
      });
      for (let i = 0; i < 5; i++) expect(await attempt(login, RIGHT)).toBe(200);
    });

    it('a database failure says nothing about the password, so it is not counted', async () => {
      const login = createLoginHandler({
        ...options,
        throttle: new LoginThrottle('login', 3),
      });
      // Only the password check fails: the limit's own table stays up.
      await t.pglite.exec('ALTER TABLE core.users RENAME TO users_down');
      try {
        for (let i = 0; i < 4; i++) expect(await attempt(login, RIGHT)).toBe(500);
      } finally {
        await t.pglite.exec('ALTER TABLE core.users_down RENAME TO users');
      }
      expect(await attempt(login, RIGHT)).toBe(200);
    });
  });

  it('a successful sign-in clears the per-email count', async () => {
    const login = createLoginHandler({
      ...options,
      emailThrottle: new LoginThrottle('login-email', 3),
    });
    const attempt = (password: string) =>
      jsonLogin(login, { email: 'tara.teacher@example.test', password });
    for (let i = 0; i < 2; i++) expect((await attempt('nope-nope')).status).toBe(401);
    expect((await attempt('fictional-password-1')).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await attempt('nope-nope')).status).toBe(401);
    expect((await attempt('fictional-password-1')).status).toBe(200);
  });

  it('form login redirects (303) to a safe relative next path; open redirects are refused', async () => {
    const login = createLoginHandler(options);
    const form = (fields: Record<string, string>) =>
      login(
        new Request('http://localhost/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
        }),
      );
    const ok = await form({
      email: 'tara.teacher@example.test',
      password: 'fictional-password-1',
      next: '/academic',
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/academic');
    const evil = await form({
      email: 'tara.teacher@example.test',
      password: 'fictional-password-1',
      next: '//evil.example',
    });
    // Never the attacker's host: the platform resolves the teacher's workspace instead (D-072).
    expect(evil.headers.get('location')).not.toContain('evil');
    expect(evil.headers.get('location')).toMatch(/^(\/|http:\/\/localhost:300[0-3]\/)/);
    const bad = await form({
      email: 'tara.teacher@example.test',
      password: 'wrong-password',
      next: '/academic',
    });
    expect(bad.headers.get('location')).toBe('/login?error=invalid&next=%2Facademic');
    const outsider = await form({
      email: 'someone@gmail.com',
      password: 'fictional-password-1',
      next: '/academic',
    });
    expect(outsider.headers.get('location')).toBe('/login?error=domain&next=%2Facademic');
  });

  it('logout revokes the session and clears the cookie', async () => {
    const { token } = await createSession(db, { userId, secret: SECRET });
    const res = await createLogoutHandler(options)(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await validateSession(db, token, SECRET)).toBeNull();
  });
});
