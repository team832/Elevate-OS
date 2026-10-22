import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, sessions, userRoles, users, type Database } from '@elevate/database';
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
    const prod = serializeCookie(SESSION_COOKIE, 'abc', sessionCookieOptions(60, 'production'));
    expect(prod).toContain('; Secure');
    expect(clearSessionCookie('development')).toContain('Max-Age=0');
    expect(parseCookieHeader('a=1; elevate_session=xyz; b=2').get(SESSION_COOKIE)).toBe('xyz');
  });
});

describe('login / logout handlers', () => {
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
      throttle: new LoginThrottle({ maxFailures: 3 }),
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
