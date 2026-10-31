import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
// @ts-expect-error exported at runtime, missing from its types
import { getMiddlewareMatchers } from 'next/dist/build/analysis/get-page-static-info';
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import nextConfig from '../../next.config';
import { config, proxy } from '../../src/proxy';

describe('a POST to a page from another site is refused, not a crash (RVA-004)', () => {
  it.each([
    ['http://localhost:3003', 200],
    ['https://evil.example', 403],
    ['null', 403],
  ])('Origin %s answers %i', (origin, status) => {
    const request = new NextRequest('http://localhost:3003/login', { method: 'POST', headers: { origin, host: 'localhost:3003' } });
    expect(proxy(request).status).toBe(status);
  });
});

describe('a form posted to a path the proxy skips reaches it, and nothing else does (RVA-008)', () => {
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, nextConfig));
  const multipart = { 'content-type': 'multipart/form-data; boundary=x' };
  it.each([
    ['/_next/x', multipart, true],
    ['/robots.txtx', multipart, true],
    ['/favicon.icox', multipart, true],
    ['/normal-page', multipart, true],
    // Static files stay out of the proxy, and API routes keep their own guard.
    ['/_next/static/a.js', {}, false],
    ['/favicon.ico', {}, false],
    ['/api/nope', multipart, false],
    ['/marketing/x', multipart, false],
  ] as const)('%s %j: %s', (path, headers, expected) => {
    expect(matches(path, { headers } as never, {})).toBe(expected);
  });
});

describe('zone rewrites keep internal routes off the public host (HAT-004)', () => {
  const firstMatch = <R extends { source: string }>(rules: R[], path: string) =>
    rules
      .map((rule) => ({
        rule,
        params: getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(path),
      }))
      .find((m) => m.params);

  describe.each(['marketing', 'academic', 'ops'])('/%s', (zone) => {
    it.each([
      `/${zone}`,
      `/${zone}/leads/abc`,
      `/${zone}/api/v1/leads`,
      `/${zone}/api/internals`,
      `/${zone}/_next/static/chunks/a.js`,
    ])('%s is forwarded whole to the zone', async (path) => {
      const rules = (await nextConfig.rewrites!()) as { source: string; destination: string }[];
      const hit = firstMatch(rules, path);
      expect(hit).toBeDefined();
      const { parsedDestination } = prepareDestination({
        appendParamsToQuery: false,
        destination: hit!.rule.destination,
        params: hit!.params as Record<string, string>,
        query: {},
      });
      expect(parsedDestination.pathname).toBe(path);
    });

    it.each([
      `/${zone}/api/internal`,
      `/${zone}/api/internal/v1/summary`,
      `/${zone}/API/Internal/v1/summary`,
    ])('%s stays on the platform: no rewrite, and its 404 keeps the security headers', async (path) => {
      expect(firstMatch((await nextConfig.rewrites!()) as { source: string }[], path)).toBeUndefined();
      expect(firstMatch(await nextConfig.headers!(), path)).toBeDefined();
    });
  });
});

describe('platform proxy', () => {
  it('redirects visitors without a session cookie to /login with next', () => {
    const res = proxy(new NextRequest('http://localhost:3000/admin/users?tab=1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fadmin%2Fusers%3Ftab%3D1',
    );
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('lets the public front page, the login page and requests with a session cookie through', () => {
    for (const path of ['/', '/login'])
      expect(
        proxy(new NextRequest(`http://localhost:3000${path}`)).headers.get('location'),
      ).toBeNull();
    const withCookie = new NextRequest('http://localhost:3000/', {
      headers: { cookie: 'elevate_session=abc' },
    });
    expect(proxy(withCookie).headers.get('x-middleware-next')).toBe('1');
  });

  it('does not match API routes, Next internals or module zones', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ['/', '/admin/users', '/login']) expect(re.test(path)).toBe(true);
    for (const path of [
      '/api/health',
      '/_next/static/x.js',
      '/favicon.ico',
      '/icon.svg',
      '/marketing',
      '/academic/x',
      '/ops',
    ])
      expect(re.test(path)).toBe(false);
    expect(re.test('/operations')).toBe(true);
  });
});
