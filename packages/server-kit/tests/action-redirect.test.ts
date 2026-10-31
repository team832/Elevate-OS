/** FLB-010: a server action lands on the right page with scripts and before they have loaded. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => null }));

const { actionRedirect, requirePageAccess } = await import('../src/next');

describe('actionRedirect', () => {
  beforeEach(() => {
    state.headers = new Headers();
  });

  it.each([
    [
      'scripts sent the form: Next adds the basePath, so the path has none',
      { 'next-action': 'x' },
      '/ideas/1?notice=Saved',
    ],
    [
      'a plain form post: the Location is used as written, so it keeps the basePath',
      {},
      '/marketing/ideas/1?notice=Saved',
    ],
  ])('%s', async (_, headers, expected) => {
    state.headers = new Headers(headers as Record<string, string>);
    await expect(actionRedirect('/marketing/ideas/1?notice=Saved', '/marketing')).rejects.toThrow(
      `REDIRECT ${expected}`,
    );
  });
});

/** HUS-020: the query string the page was opened with survives sign-in, so `?open=<id>` still opens. */
describe('requirePageAccess when signed out', () => {
  const page = (returnTo: string) =>
    requirePageAccess('ops:leads:read', {
      loginPath: '/ops/login',
      returnTo,
      basePath: '/ops',
    });

  it.each([
    ['the query string the proxy forwarded', '/ops/leads', '?open=abc&tab=x', '/ops/leads?open=abc&tab=x'],
    ['nothing to add', '/ops/leads', '', '/ops/leads'],
    ['a page that states its own query keeps it', '/ops/students/1?tab=fees', '?tab=x', '/ops/students/1?tab=fees'],
  ])('%s', async (_, returnTo, search, next) => {
    state.headers = new Headers({ 'x-return-search': search });
    await expect(page(returnTo)).rejects.toThrow(
      `REDIRECT /login?next=${encodeURIComponent(next)}`,
    );
  });
});
