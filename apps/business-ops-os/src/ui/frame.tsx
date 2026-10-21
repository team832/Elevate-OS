/**
 * Page frame for every Business Ops screen: server-side access check
 * (requirePageAccess, before any Suspense boundary so signed-out visitors get a
 * real 307), AppShell with the module navigation, and helpers for the four
 * screen states (loading via <Suspense>, empty, error, success).
 */
import { Suspense, type ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { AppError } from '@elevate/shared-contracts';
import { currentRequestId, requirePageAccess, type PageAccess } from '@elevate/server-kit/next';
import { AppShell, ButtonLink, ErrorState, LoadingState, type Crumb } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import { searchable } from '../server/search';
import { SearchShortcut } from './global-search';

type NavRow = [key: string, label: string, href: string, permission: Permission];
const section = (group: string | undefined, rows: NavRow[]) =>
  rows.map(([key, label, href, permission]) => ({ key, label, href, permission, group }));

/**
 * Module navigation (sidebar): always-open groups by the job staff came to do. Each
 * link shows only with its permission. Settings is reached from the link at the
 * bottom of the sidebar (see SETTINGS_KEYS).
 */
const NAV = [
  ...section('Today', [
    ['home', 'Today', '/ops', 'ops:module:access'],
    ['tasks', 'My day', '/ops/tasks', 'ops:tasks:read'],
  ]),
  ...section('Admissions', [
    ['overview', 'Overview', '/ops/admissions/overview', 'ops:admissions:read'],
    ['admissions', 'Demo students', '/ops/admissions', 'ops:leads:read'],
    ['applications', 'Applications', '/ops/admissions/applications', 'ops:admissions:read'],
    ['leads', 'Leads', '/ops/leads', 'ops:leads:read'],
    ['meetings', 'Events and counselling', '/ops/meetings', 'ops:appointments:read'],
  ]),
  ...section('Students', [
    ['students', 'Active students', '/ops/students', 'ops:students:read'],
    ['past', 'Past students', '/ops/students/past', 'ops:students:read'],
  ]),
  ...section('Money', [
    ['fees', 'Fee structure', '/ops/fees', 'ops:fees:read'],
    ['approvals', 'Approvals', '/ops/operations/approvals', 'ops:module:access'],
  ]),
  ...section('People', [
    ['teachers', 'Teachers', '/ops/teachers', 'ops:teachers:read'],
    ['staff', 'Staff directory', '/ops/staff', 'ops:organisation:read'],
  ]),
  ...section('Reports', [['reports', 'Reports', '/ops/reports', 'ops:module:access']]),
  ...section('Settings', [['settings', 'Settings', '/ops/settings', 'ops:settings:read']]),
];

/** Nav keys whose pages are "Settings" (bottom of the sidebar, not in the module list). */
const SETTINGS_KEYS = new Set(['settings']);

/** Unread in-app notifications for the user; null (indicator hidden) when unknown. */
async function unreadFor(access: PageAccess): Promise<number | null> {
  if (!can(access.user, 'platform:notifications:read')) return null;
  try {
    return await countUnread(getDb(), access.user.id);
  } catch {
    return null;
  }
}

export function gate(permission: Permission, returnTo: string): Promise<PageAccess> {
  return requirePageAccess(permission, {
    loginPath: MODULE_PATHS.login,
    returnTo,
    basePath: MODULE.basePath,
  });
}

export async function Frame({
  access,
  active,
  query,
  children,
}: {
  access: PageAccess;
  active: string;
  /** The search text to keep in the top-bar box (the search page). */
  query?: string;
  children: ReactNode;
}) {
  const user = access.user;
  const canSearch = searchable(user);
  const visible = NAV.filter((n) => can(user, n.permission));
  const nav = visible
    .filter((n) => !SETTINGS_KEYS.has(n.key))
    .map((n) => ({ href: n.href, label: n.label, group: n.group, active: n.key === active }));
  const settingsPage = visible.find((n) => n.key === active && SETTINGS_KEYS.has(n.key));
  const breadcrumbs: Crumb[] | undefined = settingsPage
    ? [
        { label: 'Business Operations', href: '/ops' },
        { label: 'Settings', href: '/ops/settings' },
      ]
    : undefined;
  return (
    <AppShell
      user={user}
      modules={access.modules}
      current="ops"
      logoutAction={MODULE_PATHS.logoutApi}
      nav={nav}
      breadcrumbs={breadcrumbs}
      search={
        canSearch
          ? {
              action: '/ops/search',
              // Phone and email matching needs contact access (server/search.ts).
              label: can(user, 'ops:student_private:read')
                ? 'Search name or phone'
                : 'Search name or reference',
              defaultValue: query,
            }
          : undefined
      }
      settings={
        can(user, 'ops:settings:read')
          ? { href: '/ops/settings', active: Boolean(settingsPage) }
          : undefined
      }
      unreadNotifications={await unreadFor(access)}
    >
      {canSearch ? <SearchShortcut inputId="el-search-ops" /> : null}
      {access.status === 'forbidden' ? (
        <ErrorState
          title="No access"
          description="Your roles do not allow this page. Ask an operations manager or a platform administrator."
        />
      ) : (
        children
      )}
    </AppShell>
  );
}

/** Suspense wrapper: shows the loading state while the async section loads. */
export function Section({ children, label }: { children: ReactNode; label?: string }) {
  return <Suspense fallback={<LoadingState label={label ?? 'Loading…'} />}>{children}</Suspense>;
}

// An empty href reloads this page with its query: a retry that works without JavaScript.
const retry = <ButtonLink href="">Try again</ButtonLink>;

/** Load data for a section; returns either the data or a rendered error state. */
export async function load<T>(
  fn: (db: ReturnType<typeof getDb>) => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; view: ReactNode }> {
  try {
    return { ok: true, data: await fn(getDb()) };
  } catch (error) {
    const requestId = await currentRequestId().catch(() => undefined);
    if (error instanceof AppError && error.status < 500) {
      return {
        ok: false,
        view: (
          <ErrorState
            title={error.status === 404 ? 'Not found' : 'Cannot show this'}
            description={error.message}
            requestId={requestId}
          />
        ),
      };
    }
    console.error('ops page section failed', error);
    return { ok: false, view: <ErrorState requestId={requestId} action={retry} /> };
  }
}
