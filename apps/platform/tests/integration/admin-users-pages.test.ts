/**
 * Users & roles pages: signed-out visitors are redirected to sign-in (before any
 * Suspense boundary), people without platform:users:read get the "No access"
 * state and no data, and the nav/Settings links appear only for readers.
 * next/headers and next/navigation are stubbed; the session check is real.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ErrorState } from '@elevate/shared-ui';
import { createTestUser, setupTestDatabase } from '@elevate/testing';

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'elevate_session' && session.token ? { value: session.token } : undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  useRouter: () => ({}),
}));

const { default: UsersPage } = await import('../../src/app/admin/users/page');
const { default: UserPage } = await import('../../src/app/admin/users/[id]/page');

const ctx = setupTestDatabase();
type Shell = ReactElement<{
  children: ReactElement<{ title?: string }>;
  nav: { href: string; label: string }[];
  settings?: { href: string };
}>;
const id = '00000000-0000-4000-8000-000000000001';
const pages = [
  ['list', () => UsersPage({ searchParams: Promise.resolve({}) }), '/admin/users'],
  ['detail', () => UserPage({ params: Promise.resolve({ id }) }), `/admin/users/${id}`],
] as const;

describe('Users & roles pages', () => {
  it.each(pages)('%s: signed out → redirect to sign-in with next', async (_n, render, path) => {
    session.token = undefined;
    await expect(render()).rejects.toThrow(`NEXT_REDIRECT /login?next=${encodeURIComponent(path)}`);
  });

  it.each(pages)('%s: a teacher sees "No access" and no links to it', async (_n, render) => {
    session.token = (await createTestUser(ctx.db, { roles: ['teacher'] })).token;
    const page = (await render()) as Shell;
    expect(page.props.children.type).toBe(ErrorState);
    expect(page.props.children.props.title).toBe('No access');
    expect(page.props.nav.map((n) => n.label)).not.toContain('Users & roles');
    expect(page.props.settings).toBeUndefined();
  });

  it.each(pages)('%s: a director gets the page, the nav item and Settings', async (_n, render) => {
    session.token = (await createTestUser(ctx.db, { roles: ['director'] })).token;
    const page = (await render()) as Shell;
    expect(page.props.children.type).not.toBe(ErrorState);
    expect(page.props.nav).toContainEqual(
      expect.objectContaining({ href: '/admin/users', label: 'Users & roles' }),
    );
    expect(page.props.settings?.href).toBe('/admin/users');
  });
});
