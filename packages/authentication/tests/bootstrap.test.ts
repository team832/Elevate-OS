/**
 * First-owner bootstrap (D-030): an email listed in BOOTSTRAP_OWNER_EMAILS gets
 * platform_admin + director at sign-in, idempotently, audited once.
 * (Google sign-in uses the same openSession path; see google.test.ts.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadEnvKeys } from '@elevate/configuration';
import { auditEvents, sessions, userRoles, users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import { createLoginHandler, hashPassword, isAllowedEmail } from '../src/index';

const SECRET = 'test-only-session-secret-0123456789-abcdefghij';
const PASSWORD = 'fictional-password-1';
let t: TestDatabase;
let db: Database;
const login = createLoginHandler({
  module: 'platform',
  loginPath: '/login',
  defaultRedirect: '/',
  getDb: () => db,
  getSecret: () => SECRET,
});

async function person(email: string) {
  const [u] = await db
    .insert(users)
    .values({
      email,
      displayName: 'Bootstrap Person (fictional)',
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning({ id: users.id });
  return u!.id;
}
const signIn = (email: string) =>
  login(
    new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
const rolesOf = async (id: string) =>
  (
    await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, id as never))
  )
    .map((r) => r.role)
    .sort();
const bootstrapAudits = (id: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, 'role.bootstrapped'), eq(auditEvents.entityId, id)));

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());
afterEach(() => vi.unstubAllEnvs());

describe('BOOTSTRAP_OWNER_EMAILS at sign-in', () => {
  it('a listed email gets platform_admin and director once; the audit is written once', async () => {
    const id = await person('fictional.owner@elevateeducation.in');
    vi.stubEnv(
      'BOOTSTRAP_OWNER_EMAILS',
      'someone.else@elevateeducation.in, Fictional.Owner@elevateeducation.in',
    );
    expect((await signIn('fictional.owner@elevateeducation.in')).status).toBe(200);
    expect(await rolesOf(id)).toEqual(['director', 'platform_admin']);
    expect((await signIn('fictional.owner@elevateeducation.in')).status).toBe(200);
    expect(await rolesOf(id)).toEqual(['director', 'platform_admin']);
    const audits = await bootstrapAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'system',
      module: 'platform',
      entityType: 'user',
      after: { roles: ['director', 'platform_admin'] },
    });
  });

  it('an unlisted email gets nothing', async () => {
    const id = await person('fictional.staff@elevateeducation.in');
    vi.stubEnv('BOOTSTRAP_OWNER_EMAILS', 'fictional.owner@elevateeducation.in');
    expect((await signIn('fictional.staff@elevateeducation.in')).status).toBe(200);
    expect(await rolesOf(id)).toEqual([]);
    expect(await bootstrapAudits(id)).toHaveLength(0);
  });

  it('an invalid list is refused: sign-in fails and opens no session', async () => {
    const id = await person('fictional.third@elevateeducation.in');
    vi.stubEnv('BOOTSTRAP_OWNER_EMAILS', 'fictional.third@elevateeducation.in, owner@gmail.com');
    const res = await signIn('fictional.third@elevateeducation.in');
    expect(res.status).toBe(500);
    expect(await rolesOf(id)).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(0);
  });

  it('the configuration rule matches isAllowedEmail(email, "production")', () => {
    for (const email of [
      'a@elevateeducation.in',
      'a@example.test',
      'a@gmail.com',
      'a@sub.elevateeducation.in',
      'a@elevateeducation.in.evil.com',
      '@elevateeducation.in',
    ]) {
      const accepted = (() => {
        try {
          return (
            loadEnvKeys(['BOOTSTRAP_OWNER_EMAILS'], { BOOTSTRAP_OWNER_EMAILS: email })
              .BOOTSTRAP_OWNER_EMAILS.length === 1
          );
        } catch {
          return false;
        }
      })();
      expect(accepted, email).toBe(isAllowedEmail(email, 'production'));
    }
  });
});
