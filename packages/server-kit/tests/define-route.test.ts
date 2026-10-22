import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { idempotencyKeys, programmes } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { ConflictError, created, defineRoute, NotFoundError } from '../src/index';

const ctx = setupTestDatabase();

const echo = defineRoute(
  {
    permission: 'academic:batches:write',
    params: z.object({ id: z.uuid() }),
    query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
    body: z.object({ name: z.string().min(3) }),
  },
  async ({ params, query, body, user, scope }) => ({
    id: params.id,
    dryRun: query.dryRun,
    name: body.name,
    by: user.id,
    scope,
  }),
);

const ID = '0b6f8f2e-3c1a-4f7e-9b2d-1a2b3c4d5e6f';

describe('defineRoute', () => {
  it('401 UNAUTHENTICATED without a session', async () => {
    const res = await callRoute(
      echo,
      buildRequest(`/academic/api/v1/batches/${ID}`, { json: { name: 'Batch A' } }),
      { id: ID },
    );
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe('UNAUTHENTICATED');
    expect(res.error?.requestId).toBeTruthy();
    expect(res.headers.get('x-request-id')).toBe(res.error?.requestId);
  });

  it('403 FORBIDDEN when signed in without the permission (checked before validation)', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    const res = await callRoute(
      echo,
      authedRequest(teacher, `/academic/api/v1/batches/not-a-uuid`, { json: {} }),
      { id: 'not-a-uuid' },
    );
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
  });

  it('400 VALIDATION_FAILED with field details for bad params, query and body', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const badParams = await callRoute(
      echo,
      authedRequest(coordinator, `/x/bad`, { json: { name: 'Batch A' } }),
      { id: 'bad' },
    );
    expect(badParams.status).toBe(400);
    expect(badParams.error?.details).toEqual([
      expect.objectContaining({ location: 'params', path: ['id'] }),
    ]);

    const badQuery = await callRoute(
      echo,
      authedRequest(coordinator, `/x/${ID}?dryRun=maybe`, { json: { name: 'Batch A' } }),
      { id: ID },
    );
    expect(badQuery.status).toBe(400);
    expect(badQuery.error?.details).toEqual([
      expect.objectContaining({ location: 'query', path: ['dryRun'] }),
    ]);

    const badBody = await callRoute(
      echo,
      authedRequest(coordinator, `/x/${ID}`, { json: { name: 'A' } }),
      { id: ID },
    );
    expect(badBody.status).toBe(400);
    expect(badBody.error?.code).toBe('VALIDATION_FAILED');
    expect(badBody.error?.details).toEqual([
      expect.objectContaining({ location: 'body', path: ['name'] }),
    ]);

    const notJson = await callRoute(
      echo,
      authedRequest(coordinator, `/x/${ID}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
      }),
      { id: ID },
    );
    expect(notJson.status).toBe(400);
  });

  it('refuses cross-site writes (D-072): other localhost ports share the cookie', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const post = (headers: Record<string, string>, body = JSON.stringify({ name: 'Batch A' })) =>
      callRoute(
        echo,
        new Request(`http://localhost:3001/academic/api/v1/batches/${ID}`, {
          method: 'POST',
          headers: { ...headers, cookie: `elevate_session=${coordinator.token}` },
          body,
        }),
        { id: ID },
      );
    const json = { 'content-type': 'application/json' };
    expect((await post({ ...json, origin: 'http://localhost:5173' })).status).toBe(403);
    expect((await post({ ...json, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ ...json, origin: 'http://localhost:3001' })).status).toBe(200);
    expect((await post({ ...json, origin: 'http://localhost:3000' })).status).toBe(200);
    expect((await post({ 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
    // A "simple" request a foreign page could send without a CORS preflight.
    expect((await post({ 'content-type': 'text/plain;application/json' })).status).toBe(400);
  });

  it('a route under a workspace path needs membership of that workspace (D-072)', async () => {
    const leads = defineRoute({ permission: 'ops:leads:read' }, async () => ({ ok: true }));
    const marketer = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
    const at = (path: string) => callRoute(leads, authedRequest(marketer, path));
    // The same handler mounted in Marketing OS answers; Business Ops' own path refuses.
    expect((await at('/marketing/api/v1/leads')).status).toBe(200);
    const viaOps = await at('/ops/api/v1/demos/x');
    expect(viaOps.status).toBe(403);
    expect(viaOps.error?.message).toBe('Your roles do not include this workspace.');
    expect((await at('/opsx/api/v1/leads')).status).toBe(200); // not the /ops base path
  });

  it('200 with the { data } envelope when allowed and valid', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const res = await callRoute<{
      id: string;
      dryRun: string;
      name: string;
      by: string;
      scope: string;
    }>(echo, authedRequest(coordinator, `/x/${ID}?dryRun=true`, { json: { name: 'Batch A' } }), {
      id: ID,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      id: ID,
      dryRun: 'true',
      name: 'Batch A',
      by: coordinator.id,
      scope: 'all',
    });
  });

  it('maps thrown AppErrors and unique violations; hides internal errors', async () => {
    const admin = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const notFound = defineRoute({ permission: 'authenticated' }, async () => {
      throw new NotFoundError('No such batch.');
    });
    expect((await callRoute(notFound, authedRequest(admin, '/x'))).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'No such batch.',
    });

    const duplicate = defineRoute({ permission: 'authenticated' }, async ({ db }) => {
      await db.insert(programmes).values({ code: 'DUP_TEST', name: 'x' });
      await db.insert(programmes).values({ code: 'DUP_TEST', name: 'y' });
    });
    expect((await callRoute(duplicate, authedRequest(admin, '/x'))).status).toBe(409);

    const boom = defineRoute({ permission: 'authenticated' }, async () => {
      throw new Error('secret internals: password=hunter2');
    });
    const res = await callRoute(boom, authedRequest(admin, '/x'));
    expect(res.status).toBe(500);
    expect(res.error?.code).toBe('INTERNAL');
    expect(JSON.stringify(res.error)).not.toContain('hunter2');
  });

  it('public routes run without a session; anyOf accepts any listed permission', async () => {
    const pub = defineRoute({ permission: 'public' }, async ({ user }) => ({
      signedIn: user !== null,
    }));
    expect((await callRoute(pub, buildRequest('/x'))).data).toEqual({ signedIn: false });
    const either = defineRoute(
      { permission: { anyOf: ['ops:leads:read', 'academic:students:read'] } },
      async ({ scope }) => ({ scope }),
    );
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await callRoute(either, authedRequest(teacher, '/x'))).data).toEqual({ scope: 'own' });
    const marketer = await createTestUser(ctx.db, { roles: ['platform_admin'] });
    expect((await callRoute(either, authedRequest(marketer, '/x'))).status).toBe(403);
  });

  it('created() returns 201', async () => {
    const make = defineRoute({ permission: 'authenticated' }, async () => created({ id: ID }));
    const user = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await callRoute(make, authedRequest(user, '/x', { method: 'POST' }))).status).toBe(201);
  });
});

describe('Idempotency-Key', () => {
  let counter = 0;
  const createProgramme = defineRoute(
    {
      permission: 'academic:programmes:manage',
      body: z.object({ code: z.string() }),
      idempotency: 'required',
    },
    async ({ db, body }) => {
      counter += 1;
      const [row] = await db
        .insert(programmes)
        .values({ code: body.code, name: body.code })
        .returning({ id: programmes.id });
      return created({ id: row!.id });
    },
  );

  it('runs once and replays the stored response for retries', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const send = (key: string | undefined, code: string) =>
      callRoute<{ id: string }>(
        createProgramme,
        authedRequest(coordinator, '/academic/api/v1/programmes', {
          json: { code },
          headers: key ? { 'idempotency-key': key } : {},
        }),
      );
    const first = await send('key-0001-abcdef', 'IDEMP_A');
    const second = await send('key-0001-abcdef', 'IDEMP_A');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.data?.id).toBe(first.data?.id);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(counter).toBe(1);
    expect(
      await ctx.db.select().from(programmes).where(eq(programmes.code, 'IDEMP_A')),
    ).toHaveLength(1);

    const reused = await send('key-0001-abcdef', 'IDEMP_B');
    expect(reused.status).toBe(409);
    expect((await send(undefined, 'IDEMP_C')).status).toBe(400);
  });

  it('a failed request leaves no key behind, so a retry runs again', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const failing = defineRoute(
      { permission: 'academic:programmes:manage', body: z.object({}), idempotency: 'optional' },
      async () => {
        throw new ConflictError('nope');
      },
    );
    const req = () =>
      authedRequest(coordinator, '/fail', {
        json: {},
        headers: { 'idempotency-key': 'key-fail-0001' },
      });
    expect((await callRoute(failing, req())).status).toBe(409);
    expect(
      await ctx.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'key-fail-0001')),
    ).toHaveLength(0);
  });
});
