import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import {
  createHealthHandler,
  defineInternalRoute,
  defineInternalWriteRoute,
  fetchInternal,
  getInternalServiceTokens,
  sendInternal,
} from '../src/index';

const ctx = setupTestDatabase();
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN!;
const OPS_TOKEN = 'test-only-ops-module-token-for-vitest-runs-0002';
const ACADEMIC_TOKEN = 'test-only-academic-module-token-for-vitest-0003';

const summary = defineInternalRoute({ callers: ['ops', 'platform'] }, async ({ caller }) => ({
  servedTo: caller,
}));
const call = (token: string, caller: string) =>
  callRoute(
    summary,
    buildRequest('/x', {
      headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': caller },
    }),
  );

describe('internal service auth', () => {
  it('rejects missing or wrong tokens (401) and disallowed callers (403)', async () => {
    expect(
      (await callRoute(summary, buildRequest('/academic/api/internal/v1/summary'))).status,
    ).toBe(401);
    expect((await call('wrong-token', 'ops')).status).toBe(401);
    expect((await call(TOKEN, 'marketing')).status).toBe(403);
  });

  it('serves allowed callers', async () => {
    expect((await call(TOKEN, 'ops')).data).toEqual({ servedTo: 'ops' });
  });

  describe('per-module tokens (INTERNAL_SERVICE_TOKENS)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('single-token fallback is unchanged when the map is absent', () => {
      vi.stubEnv('INTERNAL_SERVICE_TOKENS', '');
      expect(getInternalServiceTokens()).toBeUndefined();
    });

    it('binds the caller to the token that matched', async () => {
      vi.stubEnv('INTERNAL_SERVICE_TOKENS', `ops:${OPS_TOKEN}, academic:${ACADEMIC_TOKEN}`);
      expect((await call(OPS_TOKEN, 'ops')).data).toEqual({ servedTo: 'ops' });
      // a caller cannot claim another module's token, nor use the shared one
      expect((await call(ACADEMIC_TOKEN, 'ops')).status).toBe(403);
      expect((await call(TOKEN, 'ops')).status).toBe(401);
      expect((await call(OPS_TOKEN, 'nobody')).status).toBe(403);
    });

    it('refuses a malformed map', () => {
      expect(() => getInternalServiceTokens('ops:short')).toThrow(/INTERNAL_SERVICE_TOKENS/);
      expect(() => getInternalServiceTokens(`crm:${OPS_TOKEN}`)).toThrow(/INTERNAL_SERVICE_TOKENS/);
    });

    it('fetchInternal sends the caller module’s own token', async () => {
      vi.stubEnv('INTERNAL_SERVICE_TOKENS', `ops:${OPS_TOKEN}`);
      let sent: string | undefined;
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        sent = (init.headers as Record<string, string>).authorization;
        return Response.json({ data: { n: 1 } });
      }) as unknown as typeof fetch;
      await fetchInternal('http://x', z.object({ n: z.number() }), { caller: 'ops', fetchImpl });
      expect(sent).toBe(`Bearer ${OPS_TOKEN}`);
    });
  });
});

describe('internal write routes', () => {
  const USER = '00000000-0000-4000-8000-000000000001';
  const write = defineInternalWriteRoute(
    { callers: ['ops'], body: z.strictObject({ score: z.string() }) },
    async ({ body, actingUserId, caller }) => ({ body, actingUserId, caller }),
  );
  const headers = (o: Record<string, string | undefined> = {}) =>
    Object.fromEntries(
      Object.entries({
        authorization: `Bearer ${TOKEN}`,
        'x-elevate-caller': 'ops',
        'x-elevate-acting-user': USER,
        'content-type': 'application/json',
        ...o,
      }).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;
  const post = (h: Record<string, string>, body = '{"score":"12.5"}') =>
    callRoute(write, new Request('http://localhost/x', { method: 'POST', headers: h, body }));

  it('passes the validated body and the acting user to the handler', async () => {
    expect((await post(headers())).data).toEqual({
      body: { score: '12.5' },
      actingUserId: USER,
      caller: 'ops',
    });
  });

  it.each([
    ['wrong token', headers({ authorization: 'Bearer nope' }), undefined, 401],
    ['caller not listed', headers({ 'x-elevate-caller': 'marketing' }), undefined, 403],
    ['no acting user', headers({ 'x-elevate-acting-user': undefined }), undefined, 400],
    ['acting user not a uuid', headers({ 'x-elevate-acting-user': 'bob' }), undefined, 400],
    ['not JSON media type', headers({ 'content-type': 'text/plain' }), undefined, 400],
    ['broken JSON', headers(), '{', 400],
    ['body off-contract', headers(), '{"score":12}', 400],
  ])('refuses: %s', async (_name, h, body, status) => {
    expect((await post(h, body)).status).toBe(status);
  });

  it('read routes ignore bodies and keep actingUserId null', async () => {
    const read = defineInternalRoute({}, async ({ actingUserId, body }) => ({
      actingUserId,
      body,
    }));
    const res = await callRoute(read, buildRequest('/x', { headers: headers() }));
    expect(res.data).toEqual({ actingUserId: null });
  });

  describe('sendInternal', () => {
    const schema = z.object({ body: z.object({ score: z.string() }), actingUserId: z.string() });
    const viaRoute = (async (url: string, init: RequestInit) =>
      write(new Request(url, init), { params: Promise.resolve({}) })) as unknown as typeof fetch;
    const send = (body: unknown, fetchImpl = viaRoute, token = TOKEN) =>
      sendInternal('http://localhost/x', schema, {
        caller: 'ops',
        actingUserId: USER,
        body,
        token,
        fetchImpl,
      });

    it('sends token, caller, acting user and JSON body', async () => {
      expect(await send({ score: '4' })).toEqual({
        ok: true,
        data: { body: { score: '4' }, actingUserId: USER },
      });
    });

    it('returns the server refusal with its code and details', async () => {
      const res = await send({ score: 4 });
      expect(res).toMatchObject({ ok: false, status: 400, error: { code: 'VALIDATION_FAILED' } });
      expect(res.ok === false && res.error.details).toBeTruthy();
      expect(await send({ score: '4' }, viaRoute, 'wrong')).toMatchObject({
        ok: false,
        status: 401,
      });
    });

    it('never reports success for unreachable sources or off-contract replies', async () => {
      const down = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      expect(await send({}, down)).toMatchObject({ ok: false, status: 0 });
      const odd = (async () => Response.json({ data: { n: 1 } })) as unknown as typeof fetch;
      expect(await send({}, odd)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT_MISMATCH' },
      });
      const bare = (async () => new Response('x', { status: 502 })) as unknown as typeof fetch;
      expect(await send({}, bare)).toMatchObject({ ok: false, status: 502 });
    });
  });
});

describe('fetchInternal', () => {
  const schema = z.object({ n: z.number() });
  it('returns available data that matches the contract', async () => {
    const fetchImpl = (async () => Response.json({ data: { n: 3 } })) as unknown as typeof fetch;
    expect(await fetchInternal('http://x', schema, { caller: 'ops', fetchImpl })).toMatchObject({
      status: 'available',
      data: { n: 3 },
    });
  });
  it('never substitutes zero: failures and contract mismatches are "unavailable"', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(
      await fetchInternal('http://x', schema, { caller: 'ops', fetchImpl: down }),
    ).toMatchObject({ status: 'unavailable' });
    const wrongShape = (async () =>
      Response.json({ data: { n: 'three' } })) as unknown as typeof fetch;
    expect(
      await fetchInternal('http://x', schema, { caller: 'ops', fetchImpl: wrongShape }),
    ).toMatchObject({ status: 'unavailable' });
    const error500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect(
      await fetchInternal('http://x', schema, { caller: 'ops', fetchImpl: error500 }),
    ).toMatchObject({ status: 'unavailable', reason: 'HTTP 500' });
  });
});

describe('health', () => {
  it('reports database ok', async () => {
    const res = await createHealthHandler({
      app: 'test',
      module: 'platform',
      getDb: () => ctx.db,
    })();
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { data: { checks: { database: string } } }).data.checks.database,
    ).toBe('ok');
  });
});

describe('toAppPath (Next redirect() adds basePath itself)', () => {
  it('strips the basePath only when present', async () => {
    const { toAppPath } = await import('../src/paths');
    expect(toAppPath('/academic/login?next=%2Facademic', '/academic')).toBe(
      '/login?next=%2Facademic',
    );
    expect(toAppPath('/academic', '/academic')).toBe('/');
    expect(toAppPath('/academics', '/academic')).toBe('/academics');
    expect(toAppPath('/login', '')).toBe('/login');
  });
});
