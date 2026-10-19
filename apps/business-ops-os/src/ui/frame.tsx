/**
 * Page frame for every Business Ops screen: server-side access check
 * (requirePageAccess, before any Suspense boundary so signed-out visitors get a
 * real 307), AppShell with the module navigation, and helpers for the four
 * screen states (loading via <Suspense>, empty, error, success).
 */
import { Suspense, type ReactNode } from 'react';
import { can, type Permission } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { AppError } from '@elevate/shared-contracts';
import { currentRequestId, requirePageAccess, type PageAccess } from '@elevate/server-kit/next';
import { AppShell, ErrorState, LoadingState } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';

const NAV: { key: string; label: string; href: string; permission: Permission }[] = [
  { key: 'home', label: 'Dashboard', href: '/ops', permission: 'ops:module:access' },
  { key: 'leads', label: 'Leads', href: '/ops/leads', permission: 'ops:leads:read' },
  { key: 'schedule', label: 'Schedule', href: '/ops/schedule', permission: 'ops:leads:read' },
  {
    key: 'admissions',
    label: 'Admissions',
    href: '/ops/admissions',
    permission: 'ops:admissions:read',
  },
  { key: 'tasks', label: 'Tasks', href: '/ops/tasks', permission: 'ops:tasks:read' },
  { key: 'staff', label: 'Staff', href: '/ops/staff', permission: 'ops:organisation:read' },
  { key: 'sops', label: 'SOPs', href: '/ops/sops', permission: 'ops:sops:read' },
  {
    key: 'incidents',
    label: 'Incidents',
    href: '/ops/incidents',
    permission: 'ops:incidents:read',
  },
  {
    key: 'decisions',
    label: 'Decisions',
    href: '/ops/decisions',
    permission: 'ops:decisions:read',
  },
  { key: 'risks', label: 'Risks', href: '/ops/risks', permission: 'ops:risks:read' },
  { key: 'projects', label: 'Projects', href: '/ops/projects', permission: 'ops:risks:read' },
  { key: 'settings', label: 'Settings', href: '/ops/settings', permission: 'ops:settings:read' },
];

export function gate(permission: Permission, returnTo: string): Promise<PageAccess> {
  return requirePageAccess(permission, {
    loginPath: MODULE_PATHS.login,
    returnTo,
    basePath: MODULE.basePath,
  });
}

export function Frame({
  access,
  active,
  children,
}: {
  access: PageAccess;
  active: string;
  children: ReactNode;
}) {
  const nav = NAV.filter((n) => can(access.user, n.permission)).map((n) => ({
    href: n.href,
    label: n.label,
    active: n.key === active,
  }));
  return (
    <AppShell
      user={access.user}
      modules={access.modules}
      current="ops"
      logoutAction={MODULE_PATHS.logoutApi}
      nav={nav}
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
