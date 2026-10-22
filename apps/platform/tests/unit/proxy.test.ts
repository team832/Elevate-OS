import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config, proxy } from '../../src/proxy';

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
