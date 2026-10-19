/**
 * Page frame for Academic OS: server-side access check + AppShell with the
 * module navigation (items shown only for permissions the user holds — cosmetic;
 * every page and route checks again on the server).
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, type Permission } from '@elevate/authorization';
import { requirePageAccess, type PageAccess } from '@elevate/server-kit/next';
import { AppShell, ErrorState } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import type { Actor } from '../server/context';

export type Section =
  | 'home'
  | 'curriculum'
  | 'batches'
  | 'timetable'
  | 'teaching'
  | 'assessments'
  | 'students'
  | 'progress'
  | 'intake';

const NAV: { key: Section; label: string; href: string; permission: Permission }[] = [
  { key: 'home', label: 'Dashboard', href: MODULE_PATHS.home, permission: 'academic:module:access' },
  { key: 'curriculum', label: 'Curriculum', href: MODULE_PATHS.curriculum, permission: 'academic:courses:read' },
  { key: 'batches', label: 'Batches', href: MODULE_PATHS.batches, permission: 'academic:batches:read' },
  { key: 'timetable', label: 'Timetable', href: MODULE_PATHS.timetable, permission: 'academic:timetable:read' },
  { key: 'teaching', label: 'Teaching log', href: MODULE_PATHS.teaching, permission: 'academic:classes:read' },
  { key: 'assessments', label: 'Assessments', href: MODULE_PATHS.assessments, permission: 'academic:assessments:read' },
  { key: 'students', label: 'Students', href: MODULE_PATHS.students, permission: 'academic:students:read' },
  { key: 'progress', label: 'Progress', href: MODULE_PATHS.progress, permission: 'academic:progress:read' },
  { key: 'intake', label: 'Enrolment intake', href: MODULE_PATHS.intake, permission: 'academic:enrolments:read' },
];

/** requirePageAccess with the module's login path and basePath (browser paths, D-022). */
export function gate(permission: Permission, returnTo: string): Promise<PageAccess> {
  return requirePageAccess(permission, { loginPath: MODULE_PATHS.login, returnTo, basePath: MODULE.basePath });
}

export function actorFor(user: AuthenticatedUser): Actor {
  return { user };
}

export function AcademicShell({ access, active, children }: { access: PageAccess; active: Section; children: ReactNode }) {
  const nav = NAV.filter((n) => can(access.user, n.permission)).map((n) => ({ href: n.href, label: n.label, active: n.key === active }));
  return (
    <AppShell user={access.user} modules={access.modules} current="academic" logoutAction={MODULE_PATHS.logoutApi} nav={nav}>
      {access.status === 'forbidden' ? (
        <ErrorState title="No access to this page" description="Your roles do not include the permission this page needs. Ask an academic coordinator or a platform administrator." />
      ) : (
        children
      )}
    </AppShell>
  );
}

/** Render a load failure honestly (never as empty data). */
export function LoadError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'The data could not be loaded.';
  const notFound = typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'NOT_FOUND';
  return <ErrorState title={notFound ? 'Not found' : 'Could not load this page'} description={message} />;
}

/** Run a loader; return either its data or the error, so pages can render an ErrorState. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
