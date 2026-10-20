/**
 * Users & roles API (D-030): permissions per route and role, add person,
 * role save, disable/enable, list filters, audit rows.
 */
import { describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { validateSession } from '@elevate/authentication';
import { auditEvents, insertAuditEvent, userRoles, users } from '@elevate/database';
import type { RoleKey, UserId } from '@elevate/shared-types';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  testSessionSecret,
  type TestUser,
} from '@elevate/testing';
import * as list from '../../src/app/api/v1/admin/users/route';
import * as detail from '../../src/app/api/v1/admin/users/[id]/route';
import * as roles from '../../src/app/api/v1/admin/users/[id]/roles/route';
import * as status from '../../src/app/api/v1/admin/users/[id]/status/route';
import { setUserRoles, setUserStatus } from '../../src/server/users';

const ctx = setupTestDatabase();
const BASE = '/api/v1/admin/users';
const admin = () => createTestUser(ctx.db, { roles: ['platform_admin'] });
const audits = (id: string, action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, action)));
const rolesOf = async (id: UserId) =>
  (await ctx.db.select().from(userRoles).where(eq(userRoles.userId, id))).map((r) => r.role).sort();

/** Call a route as `user` (null = signed out); the [id] param is taken from the path. */
function send<T = unknown>(
  user: TestUser | null,
  handler: Parameters<typeof callRoute>[0],
  path: string,
  method = 'GET',
  json?: unknown,
) {
  const id = new URL(path, 'http://x').pathname.split('/')[5];
  const options = { method, json };
  const request = user ? authedRequest(user, path, options) : buildRequest(path, options);
  return callRoute<T>(handler, request, id ? { id } : {});
}
type Call = (user: TestUser | null, target: TestUser) => ReturnType<typeof send>;
/** [route, call, read-only?] */
const ROUTES: [string, Call, boolean][] = [
  ['GET list', (u) => send(u, list.GET, BASE), true],
  [
    'POST add person',
    (u) => send(u, list.POST, BASE, 'POST', { email: 'x@elevateeducation.in', displayName: 'X' }),
    false,
  ],
  ['GET detail', (u, t) => send(u, detail.GET, `${BASE}/${t.id}`), true],
  ['PUT roles', (u, t) => send(u, roles.PUT, `${BASE}/${t.id}/roles`, 'PUT', { roles: [] }), false],
  [
    'PUT status',
    (u, t) => send(u, status.PUT, `${BASE}/${t.id}/status`, 'PUT', { status: 'disabled' }),
    false,
  ],
];

describe('Users & roles: who may call what', () => {
  it.each(ROUTES)('%s: 401 signed out, 403 for a teacher', async (_n, call) => {
    const target = await createTestUser(ctx.db, { roles: ['employee'] });
    expect((await call(null, target)).status).toBe(401);
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await call(teacher, target)).status).toBe(403);
  });

  it.each(ROUTES)('%s: director and auditor may only read', async (_n, call, readOnly) => {
    for (const role of ['director', 'auditor'] as RoleKey[]) {
      const target = await createTestUser(ctx.db, { roles: ['employee'] });
      const reader = await createTestUser(ctx.db, { roles: [role] });
      expect((await call(reader, target)).status).toBe(readOnly ? 200 : 403);
    }
  });
});

describe('add a person', () => {
  it('creates an @elevateeducation.in account with no password, initial roles and an audit row', async () => {
    const a = await admin();
    const res = await send<{ id: UserId }>(a, list.POST, BASE, 'POST', {
      email: ' New.Person@ElevateEducation.in ',
      displayName: 'New Person (fictional)',
      roles: ['teacher', 'employee', 'teacher'],
    });
    expect(res.status).toBe(201);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, res.data!.id));
    expect(row).toMatchObject({ email: 'new.person@elevateeducation.in', passwordHash: null });
    expect(await rolesOf(res.data!.id)).toEqual(['employee', 'teacher']);
    const [audit] = await audits(res.data!.id, 'user.created');
    expect(audit).toMatchObject({ actorUserId: a.id, module: 'platform' });
  });

  it.each([
    ['outside the domain', { email: 'someone@gmail.com', displayName: 'S' }, 403],
    ['a look-alike domain', { email: 's@elevateeducation.in.evil.com', displayName: 'S' }, 403],
    ['not an email', { email: 'not-an-email', displayName: 'S' }, 400],
    ['no name', { email: 'noname@elevateeducation.in', displayName: ' ' }, 400],
    [
      'an unknown role',
      { email: 'role@elevateeducation.in', displayName: 'R', roles: ['root'] },
      400,
    ],
  ])('refuses %s', async (_n, json, code) => {
    const res = await send(await admin(), list.POST, BASE, 'POST', json);
    expect(res.status).toBe(code);
    expect(await ctx.db.select().from(users).where(eq(users.email, json.email))).toHaveLength(0);
  });

  it('refuses a duplicate email with 409', async () => {
    const a = await admin();
    const json = { email: 'twice@elevateeducation.in', displayName: 'Twice (fictional)' };
    expect((await send(a, list.POST, BASE, 'POST', json)).status).toBe(201);
    expect((await send(a, list.POST, BASE, 'POST', json)).status).toBe(409);
  });
});

describe('save roles', () => {
  const put = (actor: TestUser, id: string, json: unknown) =>
    send(actor, roles.PUT, `${BASE}/${id}/roles`, 'PUT', json);

  it('replaces the roles, takes effect on the next request and is audited with before/after', async () => {
    const a = await admin();
    const target = await createTestUser(ctx.db, { roles: ['employee'] });
    const res = await put(a, target.id, { roles: ['teacher', 'academic_coordinator'] });
    expect(res).toMatchObject({
      status: 200,
      data: { roles: ['academic_coordinator', 'teacher'] },
    });
    expect((await validateSession(ctx.db, target.token, testSessionSecret()))?.roles).toEqual([
      'academic_coordinator',
      'teacher',
    ]);
    const [audit] = await audits(target.id, 'user.roles_changed');
    expect(audit).toMatchObject({
      actorUserId: a.id,
      before: { roles: ['employee'] },
      after: { roles: ['academic_coordinator', 'teacher'] },
    });
    // Saving the same roles again changes nothing and writes no audit row.
    await put(a, target.id, { roles: ['teacher', 'academic_coordinator'] });
    expect(await audits(target.id, 'user.roles_changed')).toHaveLength(1);
  });

  it('rejects unknown role keys (400), your own roles (403) and an unknown id (404)', async () => {
    const a = await admin();
    const target = await createTestUser(ctx.db, { roles: ['employee'] });
    expect((await put(a, target.id, { roles: ['superuser'] })).status).toBe(400);
    expect((await put(a, a.id, { roles: [] })).status).toBe(403);
    expect(await rolesOf(a.id)).toEqual(['platform_admin']);
    expect((await put(a, crypto.randomUUID(), { roles: [] })).status).toBe(404);
    expect((await put(a, 'not-a-uuid', { roles: [] })).status).toBe(400);
  });

  it('another administrator may remove an administrator while one stays active', async () => {
    const [a, b] = [await admin(), await admin()];
    expect((await put(a, b.id, { roles: ['director'] })).status).toBe(200);
    expect(await rolesOf(b.id)).toEqual(['director']);
  });
});

describe('disable and enable', () => {
  const put = (actor: TestUser, id: string, value: string) =>
    send(actor, status.PUT, `${BASE}/${id}/status`, 'PUT', { status: value });

  it('disabling ends every session of that person; enabling lets them sign in again', async () => {
    const a = await admin();
    const target = await createTestUser(ctx.db, { roles: ['teacher'] });
    const res = await put(a, target.id, 'disabled');
    expect(res).toMatchObject({ status: 200, data: { status: 'disabled', sessionsRevoked: 1 } });
    expect(await validateSession(ctx.db, target.token, testSessionSecret())).toBeNull();
    expect((await audits(target.id, 'user.disabled'))[0]).toMatchObject({
      actorUserId: a.id,
      metadata: { sessionsRevoked: 1 },
    });
    // Repeating is a no-op.
    await put(a, target.id, 'disabled');
    expect(await audits(target.id, 'user.disabled')).toHaveLength(1);

    expect((await put(a, target.id, 'active')).status).toBe(200);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, target.id));
    expect(row?.status).toBe('active');
    expect(await audits(target.id, 'user.enabled')).toHaveLength(1);
    expect(await validateSession(ctx.db, target.token, testSessionSecret())).toBeNull(); // old sessions stay ended
  });

  it('nobody can disable themselves', async () => {
    const a = await admin();
    expect((await put(a, a.id, 'disabled')).status).toBe(403);
    expect(await validateSession(ctx.db, a.token, testSessionSecret())).not.toBeNull();
  });

  it('rejects an unknown status (400)', async () => {
    const a = await admin();
    expect((await put(a, (await admin()).id, 'deleted')).status).toBe(400);
  });
});

describe('the last active platform administrator is kept', () => {
  // Through the routes the caller is always a second active administrator, so this
  // guards against two administrators acting at once; the rule is called directly.
  it('cannot lose the role or be disabled (409)', async () => {
    const last = await admin();
    const others = await ctx.db
      .select({ id: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, 'platform_admin'));
    await ctx.db
      .update(users)
      .set({ status: 'disabled' })
      .where(
        inArray(
          users.id,
          others.map((o) => o.id).filter((id) => id !== last.id),
        ),
      );
    const caller = { ...(await createTestUser(ctx.db)), roles: ['platform_admin'] as RoleKey[] };
    await expect(
      setUserRoles(ctx.db, caller, last.id, ['director'], 'req-1'),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(setUserStatus(ctx.db, caller, last.id, 'disabled', 'req-2')).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    expect(await rolesOf(last.id)).toEqual(['platform_admin']);
    // Adding roles to the last administrator is fine.
    await setUserRoles(ctx.db, caller, last.id, ['director', 'platform_admin'], 'req-3');
    expect(await rolesOf(last.id)).toEqual(['director', 'platform_admin']);
  });
});

describe('list and detail', () => {
  it('searches, filters (role, status, no roles yet), sorts, pages and marks Google accounts', async () => {
    const a = await admin();
    const tag = `zq${Date.now().toString(36)}`;
    const inserted = await ctx.db
      .insert(users)
      .values(
        Array.from({ length: 27 }, (_, i) => ({
          email: `${tag}.${String(i).padStart(2, '0')}@example.test`,
          displayName: `${tag} Person ${String(i).padStart(2, '0')} (fictional)`,
          status: i === 3 ? ('disabled' as const) : ('active' as const),
        })),
      )
      .returning({ id: users.id, email: users.email });
    const id = (n: number) => inserted[n]!.id;
    await ctx.db.insert(userRoles).values([
      { userId: id(1), role: 'teacher' },
      { userId: id(2), role: 'teacher' },
      { userId: id(2), role: 'employee' },
    ]);
    await insertAuditEvent(ctx.db, {
      actorUserId: id(4),
      module: 'platform',
      action: 'user.created_via_google',
      entityType: 'user',
      entityId: id(4),
    });
    type Page = {
      items: { id: string; roles: string[]; viaGoogle: boolean; status: string }[];
      total: number;
    };
    const get = async (qs: string, q = tag) =>
      (await send<Page>(a, list.GET, `${BASE}?q=${encodeURIComponent(q)}&${qs}`)).data!;

    const first = await get('');
    expect(first.total).toBe(27);
    expect(first.items).toHaveLength(25);
    expect(first.items[0]?.id).toBe(id(0));
    expect((await get('page=2')).items.map((u) => u.id)).toEqual([id(25), id(26)]);
    expect((await get('sort=email&dir=desc')).items[0]?.id).toBe(id(26));
    expect((await get('role=teacher')).items.map((u) => u.id)).toEqual([id(1), id(2)]);
    expect((await get('role=teacher')).items[1]?.roles).toEqual(['employee', 'teacher']);
    expect((await get('role=none')).total).toBe(25);
    expect((await get('status=disabled')).items.map((u) => u.id)).toEqual([id(3)]);
    expect(first.items.find((u) => u.id === id(4))?.viaGoogle).toBe(true);
    expect(first.items.find((u) => u.id === id(5))?.viaGoogle).toBe(false);
    expect((await get('', `${tag.toUpperCase()} person 01`)).total).toBe(1); // case-insensitive name search
    expect((await get('', `${tag}%`)).total).toBe(0); // % is literal, not a wildcard
    expect((await send(a, list.GET, `${BASE}?role=root`)).status).toBe(400);
  });

  it('detail returns the account, its roles and its history, never the password hash', async () => {
    const a = await admin();
    const target = await createTestUser(ctx.db, { roles: ['employee'] });
    await send(a, roles.PUT, `${BASE}/${target.id}/roles`, 'PUT', { roles: ['teacher'] });
    const res = await send<{
      user: Record<string, unknown>;
      roles: string[];
      history: { action: string; actorName: string }[];
    }>(a, detail.GET, `${BASE}/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.data!.roles).toEqual(['teacher']);
    expect(res.data!.user).toMatchObject({ id: target.id, hasPassword: true, status: 'active' });
    expect(res.data!.user).not.toHaveProperty('passwordHash');
    expect(res.data!.history.map((h) => [h.action, h.actorName])).toEqual([
      ['user.roles_changed', a.displayName],
    ]);
    expect((await send(a, detail.GET, `${BASE}/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
