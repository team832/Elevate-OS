import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import {
  createHealthHandler,
  defineInternalRoute,
  fetchInternal,
  getInternalServiceTokens,
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
