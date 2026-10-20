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
import { AppShell, ErrorState, LoadingState, type Crumb } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';

type NavRow = [key: string, label: string, href: string, permission: Permission];
const section = (group: string | undefined, rows: NavRow[]) =>
  rows.map(([key, label, href, permission]) => ({ key, label, href, permission, group }));

/**
 * Module navigation (sidebar). Grouped items are listed under their section; the
 * section holding the current page starts expanded. Settings pages are reached
 * from the Settings link at the bottom of the sidebar (see SETTINGS_KEYS).
 */
const NAV = [
  ...section(undefined, [['home', 'Dashboard', '/ops', 'ops:module:access']]),
  ...section('Admissions', [
    ['leads', 'Leads', '/ops/leads', 'ops:leads:read'],
    ['schedule', 'Schedule', '/ops/schedule', 'ops:leads:read'],
    ['admissions', 'Admissions', '/ops/admissions', 'ops:admissions:read'],
    ['students', 'Students', '/ops/students', 'ops:students:read'],
  ]),
  ...section('People', [
    ['hr-employees', 'Employees', '/ops/hr/employees', 'ops:employees:read'],
    ['hr-departments', 'Departments', '/ops/hr/departments', 'ops:organisation:read'],
    ['staff', 'Staff directory', '/ops/staff', 'ops:organisation:read'],
    ['recruitment', 'Recruitment', '/ops/hr/recruitment', 'ops:recruitment:read'],
    ['onboarding', 'Onboarding', '/ops/hr/onboarding', 'ops:lifecycle:read'],
    ['offboarding', 'Offboarding', '/ops/hr/offboarding', 'ops:lifecycle:read'],
    ['hr-compensation', 'Compensation', '/ops/hr/compensation', 'ops:compensation:read'],
  ]),
  ...section('Time & leave', [
    ['my-time', 'My attendance & leave', '/ops/hr/attendance/me', 'ops:attendance:record'],
    ['attendance', 'Attendance', '/ops/hr/attendance', 'ops:attendance:read'],
    ['shifts', 'Shifts', '/ops/hr/shifts', 'ops:shifts:read'],
    ['leave', 'Leave', '/ops/hr/leave', 'ops:leave:read'],
    ['timesheets', 'Timesheets', '/ops/hr/timesheets', 'ops:hr_reports:read'],
  ]),
  ...section('Operations', [
    ['tasks', 'Tasks', '/ops/tasks', 'ops:tasks:read'],
    ['approvals', 'Approvals', '/ops/operations/approvals', 'ops:module:access'],
    ['sops', 'SOPs', '/ops/sops', 'ops:sops:read'],
    ['incidents', 'Incidents', '/ops/incidents', 'ops:incidents:read'],
    ['decisions', 'Decisions', '/ops/decisions', 'ops:decisions:read'],
    ['risks', 'Risks', '/ops/risks', 'ops:risks:read'],
    ['projects', 'Projects', '/ops/projects', 'ops:risks:read'],
    ['assets', 'Assets', '/ops/operations/assets', 'ops:assets:read'],
  ]),
  ...section('Reports', [['reports', 'Reports', '/ops/reports', 'ops:module:access']]),
  ...section('Settings', [
    ['settings', 'Settings', '/ops/settings', 'ops:settings:read'],
    ['policies', 'Policies & compliance', '/ops/settings/policies', 'ops:settings:read'],
  ]),
];

/** Nav keys whose pages are "Settings" (bottom of the sidebar, not in the module list). */
const SETTINGS_KEYS = new Set(['settings', 'policies']);

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
  children,
}: {
  access: PageAccess;
  active: string;
  children: ReactNode;
}) {
  const user = access.user;
  const visible = NAV.filter((n) => can(user, n.permission));
  const nav = visible
    .filter((n) => !SETTINGS_KEYS.has(n.key))
    .map((n) => ({ href: n.href, label: n.label, group: n.group, active: n.key === active }));
  const settingsPage = visible.find((n) => n.key === active && SETTINGS_KEYS.has(n.key));
  const breadcrumbs: Crumb[] | undefined = settingsPage
    ? [
        { label: 'Business Operations', href: '/ops' },
        { label: 'Settings', href: '/ops/settings' },
        ...(settingsPage.key === 'settings'
          ? []
          : [{ label: settingsPage.label, href: settingsPage.href }]),
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
        can(user, 'ops:leads:read') ? { action: '/ops/leads', label: 'Search leads' } : undefined
      }
      myWorkHref={can(user, 'ops:tasks:read') ? '/ops/tasks?view=mine' : undefined}
      settings={
        can(user, 'ops:settings:read')
          ? { href: '/ops/settings', active: Boolean(settingsPage) }
          : undefined
      }
      unreadNotifications={await unreadFor(access)}
    >
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
    return { ok: false, view: <ErrorState requestId={requestId} /> };
  }
}
