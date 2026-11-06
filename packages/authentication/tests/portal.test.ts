/**
 * Portal logins (F4-13): one-time setup codes (8 characters, 7 days, HMAC only, one live code,
 * single use) and portal sessions that are never staff sessions. Fictional data only.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { portalSetupCodes, userRoles, users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import {
  createSession,
  generateSetupCode,
  hashSetupCode,
  issueSetupCode,
  LoginThrottle,
  normaliseSetupCode,
  portalEmail,
  redeemSetupCode,
  SETUP_CODE_TTL_MS,
  STAFF_ROLE_KEYS,
  validatePortalSession,
  validateSession,
  verifyPassword,
} from '../src/index';
import type { UserId } from '@elevate/shared-types';

let t: TestDatabase;
let db: Database;
const secret = () => process.env.SESSION_SECRET!;
const NOW = new Date('2026-11-06T10:00:00Z');
const NEW_PASSWORD = 'test-only-portal-pass';

async function user(email: string, roles: ('student' | 'guardian' | 'director')[]) {
  const [u] = await db
    .insert(users)
    .values({ email, displayName: 'Aarav Example (fictional)' })
    .returning();
  if (roles.length)
    await db.insert(userRoles).values(roles.map((role) => ({ userId: u!.id, role })));
  return u!.id as UserId;
}

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());

describe('setup codes', () => {
  it('are 8 characters from an alphabet without 0, O, 1, I or L; typing is forgiving', () => {
    const codes = Array.from({ length: 200 }, generateSetupCode);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
    expect(new Set(codes).size).toBeGreaterThan(195);
    expect(normaliseSetupCode(' abcd-ef gh ')).toBe('ABCDEFGH');
  });

  it('are stored only as HMAC-SHA256(SESSION_SECRET, "portal-setup|" + code), expire in 7 days and replace the previous code', async () => {
    const id = await user(portalEmail('aarav.1001'), ['student']);
    const first = await issueSetupCode(db, { userId: id, createdBy: id, now: NOW });
    const second = await issueSetupCode(db, { userId: id, createdBy: id, now: NOW });
    const rows = await db.select().from(portalSetupCodes).where(eq(portalSetupCodes.userId, id));
    const expected = createHmac('sha256', secret())
      .update(`portal-setup|${second.code}`)
      .digest('hex');
    expect(rows.map((r) => r.codeHash)).toContain(expected);
    expect(JSON.stringify(rows)).not.toContain(first.code);
    expect(JSON.stringify(rows)).not.toContain(second.code);
    expect(rows.filter((r) => r.revokedAt === null).map((r) => r.codeHash)).toEqual([expected]);
    expect(second.expiresAt.getTime() - NOW.getTime()).toBe(SETUP_CODE_TTL_MS);
    // The replaced code no longer works; the new one does, once.
    const use = (code: string, login = 'aarav.1001', now = NOW) =>
      redeemSetupCode(db, { login, code, password: NEW_PASSWORD, now });
    expect(await use(first.code)).toBeNull();
    expect(await use(second.code, 'aarav.1002')).toBeNull(); // another login's code
    expect(await use(second.code.toLowerCase())).toBe(id);
    expect(await use(second.code)).toBeNull();
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(await verifyPassword(NEW_PASSWORD, u!.passwordHash)).toBe(true);
  });

  it('refuse an expired code and end the login’s sessions when a code is used', async () => {
    const id = await user(portalEmail('aarav.1002'), ['student']);
    const old = await issueSetupCode(db, { userId: id, createdBy: id, now: NOW });
    const after = new Date(NOW.getTime() + SETUP_CODE_TTL_MS + 1);
    const use = (code: string, now?: Date) =>
      redeemSetupCode(db, { login: 'aarav.1002', code, password: NEW_PASSWORD, now });
    expect(await use(old.code, after)).toBeNull();
    const session = await createSession(db, { userId: id, secret: secret() });
    const fresh = await issueSetupCode(db, { userId: id, createdBy: id });
    expect(await use(fresh.code)).toBe(id);
    expect(await validatePortalSession(db, session.token, secret())).toBeNull();
    expect(hashSetupCode(fresh.code)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('portal sessions are never staff sessions', () => {
  it('a portal login validates only as a portal session, a staff login only as staff', async () => {
    const portal = await user(portalEmail('aarav.1003'), ['student']);
    const staff = await user('director.portal-test@example.test', ['director']);
    const p = await createSession(db, { userId: portal, secret: secret() });
    const s = await createSession(db, { userId: staff, secret: secret() });
    expect((await validatePortalSession(db, p.token, secret()))?.id).toBe(portal);
    expect(await validateSession(db, p.token, secret())).toBeNull();
    expect(await validatePortalSession(db, s.token, secret())).toBeNull();
    expect((await validateSession(db, s.token, secret()))?.id).toBe(staff);
  });

  it('a portal session holds only its portal roles, whatever else is stored', async () => {
    const id = await user(portalEmail('aarav.1004'), ['guardian', 'director']);
    const p = await createSession(db, { userId: id, secret: secret() });
    expect((await validatePortalSession(db, p.token, secret()))?.roles).toEqual(['guardian']);
    expect(STAFF_ROLE_KEYS).not.toContain('student');
    expect(STAFF_ROLE_KEYS).not.toContain('guardian');
  });

  it('the portal bucket locks after 5 failures in 15 minutes', async () => {
    const limit = new LoginThrottle('portal');
    const key = `${portalEmail('aarav.1005')}|203.0.113.9`;
    for (let i = 0; i < 5; i++) expect(await limit.recordFailure(db, key)).toBe(true);
    expect(await limit.retryAfterMs(db, key)).toBeGreaterThan(14 * 60_000);
  });
});
