import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, userRoles, users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import type { ModuleKey, RoleKey } from '@elevate/shared-types';
import {
  createLoginHandler,
  createLogoutHandler,
  createSession,
  createWorkspaceChoiceHandler,
  hashPassword,
  LoginThrottle,
} from '../src/index';

/** D-072: after sign-in each person lands in a workspace their stored roles allow. */
const SECRET = 'test-only-session-secret-0123456789-abcdefghij';
const PASSWORD = 'test-only-password-1';
let t: TestDatabase;
let db: Database;

async function person(
  email: string,
  roles: RoleKey[],
  preferred: 'ops' | 'academic' | 'marketing' | null = null,
) {
  const [u] = await db
    .insert(users)
    .values({
      email,
      displayName: `${email} (fictional)`,
      passwordHash: await hashPassword(PASSWORD),
      preferredWorkspace: preferred,
    })
    .returning();
  for (const role of roles) await db.insert(userRoles).values({ userId: u!.id, role });
  return u!.id;
}

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  await person('ops.only@example.test', ['operations_manager']);
  await person('mkt.only@example.test', ['marketing_manager']);
  await person('two.noprefs@example.test', ['marketing_manager', 'operations_manager']);
  await person('two.prefs@example.test', ['marketing_manager', 'operations_manager'], 'marketing');
  await person('admin.only@example.test', ['platform_admin']);
});
afterAll(() => t.close());

const handler = (module: ModuleKey) =>
  createLoginHandler({
    module,
    loginPath: module === 'platform' ? '/login' : `/${module}/login`,
    defaultRedirect: module === 'platform' ? '/' : `/${module}`,
    getDb: () => db,
    getSecret: () => SECRET,
    throttle: new LoginThrottle({ maxFailures: 100 }),
  });

const formPost = (url: string, fields: Record<string, string>, origin?: string) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(origin ? { origin } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });

describe('sign-in lands in the right workspace (D-072)', () => {
  it.each<[string, ModuleKey, string | undefined, string]>([
    ['ops.only@example.test', 'ops', '/ops/students', '/ops/students'],
    ['ops.only@example.test', 'marketing', '/marketing/ideas', 'http://localhost:3000/ops'],
    ['mkt.only@example.test', 'ops', '/ops/tasks', 'http://localhost:3002/marketing'],
    ['two.noprefs@example.test', 'academic', undefined, '/academic/workspaces'],
    ['two.prefs@example.test', 'academic', undefined, 'http://localhost:3002/marketing'],
    ['two.prefs@example.test', 'ops', '/ops/students', '/ops/students'],
    ['admin.only@example.test', 'ops', undefined, '/ops/workspaces'],
    ['admin.only@example.test', 'platform', undefined, '/'],
    ['two.noprefs@example.test', 'platform', undefined, '/workspaces'],
  ])('%s on %s (next %s) → %s', async (email, module, next, location) => {
    const res = await handler(module)(
      formPost(`http://localhost/${module}/api/v1/auth/login`, {
        email,
        password: PASSWORD,
        ...(next ? { next } : {}),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(location);
    // The token travels only in the HttpOnly cookie, never in the redirect.
    expect(res.headers.get('location')).not.toMatch(/token|session/i);
    expect(res.headers.get('set-cookie')).toMatch(/^elevate_session=.+HttpOnly/);
  });

  it('a revoked role changes the landing at the next sign-in', async () => {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'two.prefs@example.test'));
    await db.delete(userRoles).where(eq(userRoles.userId, u!.id));
    await db.insert(userRoles).values({ userId: u!.id, role: 'operations_manager' });
    const res = await handler('academic')(
      formPost('http://localhost/academic/api/v1/auth/login', {
        email: 'two.prefs@example.test',
        password: PASSWORD,
      }),
    );
    // The remembered Marketing choice is ignored once no role grants Marketing.
    expect(res.headers.get('location')).toBe('http://localhost:3000/ops');
  });
});

describe('cross-site requests to the auth handlers (CSRF)', () => {
  it.each([
    ['another localhost port', 'http://localhost:5173', 403],
    ['a foreign site', 'https://evil.example', 403],
    ['an opaque origin', 'null', 403],
    ['a configured workspace origin', 'http://localhost:3001', 303],
    ['the request’s own origin', 'http://localhost', 303],
  ])('login from %s → %i', async (_name, origin, status) => {
    const res = await handler('ops')(
      formPost(
        'http://localhost/ops/api/v1/auth/login',
        { email: 'ops.only@example.test', password: PASSWORD },
        origin,
      ),
    );
    expect(res.status).toBe(status);
  });

  it('logout from another localhost port is refused', async () => {
    const res = await createLogoutHandler({
      module: 'ops',
      loginPath: '/ops/login',
      defaultRedirect: '/ops',
      getDb: () => db,
      getSecret: () => SECRET,
    })(formPost('http://localhost/ops/api/v1/auth/logout', {}, 'http://localhost:5173'));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('workspace chooser form (D-072)', () => {
  const choose = createWorkspaceChoiceHandler({
    module: 'academic',
    loginPath: '/academic/login',
    defaultRedirect: '/academic',
    getDb: () => db,
    getSecret: () => SECRET,
  });
  const post = async (email: string | null, fields: Record<string, string>, origin?: string) => {
    let cookie = '';
    if (email) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      cookie = `elevate_session=${(await createSession(db, { userId: u!.id, secret: SECRET })).token}`;
    }
    const req = formPost('http://localhost/academic/api/v1/auth/workspace', fields, origin);
    if (cookie) req.headers.set('cookie', cookie);
    return choose(req);
  };

  it('opens a permitted workspace and remembers it (audited)', async () => {
    const res = await post('two.noprefs@example.test', { workspace: 'marketing', remember: 'yes' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost:3002/marketing');
    const [u] = await db.select().from(users).where(eq(users.email, 'two.noprefs@example.test'));
    expect(u?.preferredWorkspace).toBe('marketing');
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, u!.id));
    expect(audit.map((a) => a.action)).toContain('user.workspace_preference_set');
  });

  it('opens without remembering when the box is not ticked', async () => {
    const res = await post('ops.only@example.test', { workspace: 'ops' });
    expect(res.headers.get('location')).toBe('http://localhost:3000/ops');
    const [u] = await db.select().from(users).where(eq(users.email, 'ops.only@example.test'));
    expect(u?.preferredWorkspace).toBeNull();
  });

  it.each([
    ['a workspace the roles do not grant', 'ops.only@example.test', { workspace: 'academic' }],
    ['an unknown workspace', 'ops.only@example.test', { workspace: 'platform' }],
    ['nothing chosen', 'ops.only@example.test', {}],
  ])('refuses %s (403)', async (_name, email, fields) => {
    expect((await post(email, fields)).status).toBe(403);
  });

  it('sends a signed-out visitor to sign in', async () => {
    const res = await post(null, { workspace: 'ops' });
    expect(res.headers.get('location')).toBe('/academic/login');
  });

  it('refuses a cross-site post', async () => {
    expect(
      (await post('ops.only@example.test', { workspace: 'ops' }, 'http://localhost:5173')).status,
    ).toBe(403);
  });
});
