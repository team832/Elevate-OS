import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { createHealthHandler, defineInternalRoute, fetchInternal } from '../src/index';

const ctx = setupTestDatabase();
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN!;

const summary = defineInternalRoute({ callers: ['ops', 'platform'] }, async ({ caller }) => ({
  servedTo: caller,
}));

describe('internal service auth', () => {
  it('rejects missing or wrong tokens (401) and disallowed callers (403)', async () => {
    expect(
      (await callRoute(summary, buildRequest('/academic/api/internal/v1/summary'))).status,
    ).toBe(401);
    const wrong = buildRequest('/x', {
      headers: { authorization: 'Bearer wrong-token', 'x-elevate-caller': 'ops' },
    });
    expect((await callRoute(summary, wrong)).status).toBe(401);
    const marketing = buildRequest('/x', {
      headers: { authorization: `Bearer ${TOKEN}`, 'x-elevate-caller': 'marketing' },
    });
    expect((await callRoute(summary, marketing)).status).toBe(403);
  });

  it('serves allowed callers', async () => {
    const ok = buildRequest('/x', {
      headers: { authorization: `Bearer ${TOKEN}`, 'x-elevate-caller': 'ops' },
    });
    expect((await callRoute(summary, ok)).data).toEqual({ servedTo: 'ops' });
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
