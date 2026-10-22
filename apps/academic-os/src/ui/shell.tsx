/**
 * Page frame for Academic OS: server-side access check + AppShell with the
 * module navigation (items shown only for permissions the user holds — cosmetic;
 * every page and route checks again on the server).
 */
import { Suspense, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor, workspacesFor, type Permission, type WorkspaceKey } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { requirePageAccess, workspaceHrefs, type PageAccess } from '@elevate/server-kit/next';
import { AppError } from '@elevate/shared-contracts';
import { workNav } from '@elevate/business-ops-os/work';
import { AppShell, ErrorState, LoadingState } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import type { Actor } from '../server/context';

export type Section =
  | 'home'
  | 'curriculum'
  | 'batches'
  | 'timetable'
  | 'teaching'
  | 'attendance'
  | 'assessments'
  | 'students'
  | 'progress'
  | 'intake'
  | 'teachers'
  | 'enrolments'
  | 'reviews'
  | 'meetings'
  | 'tasks'
  | 'eod'
  | 'reports'
  | 'settings';

const WORK = 'Teaching';
/** Coordination items need the permission at `all` scope: a teacher's own-scope grant never shows them. */
const COORDINATION = 'Coordination';

/**
 * Teacher order first (brief §6). Not listed, on purpose: "My attendance" (no HR attendance source
 * exists, R2) and "Resources" (no teaching-material store; concept-book indices are a Curriculum tab).
 * Tasks and the EOD report come from the shared Ops entry; its Inbox and Reports are tabs inside Tasks.
 */
const NAV: { key: Section; label: string; ownLabel?: string; href: string; permission: Permission; group: string }[] = [
  { key: 'home', label: 'My day', href: MODULE_PATHS.home, permission: 'academic:module:access', group: 'Today' },
  { key: 'meetings', label: 'My meetings', href: MODULE_PATHS.meetings, permission: 'ops:appointments:read', group: 'Today' },
  { key: 'timetable', label: 'Timetable', href: MODULE_PATHS.timetable, permission: 'academic:timetable:read', group: WORK },
  { key: 'batches', label: 'Batches', ownLabel: 'My batches', href: MODULE_PATHS.batches, permission: 'academic:batches:read', group: WORK },
  { key: 'students', label: 'Students', href: MODULE_PATHS.students, permission: 'academic:students:read', group: WORK },
  { key: 'attendance', label: 'Student attendance', href: MODULE_PATHS.studentAttendance, permission: 'academic:attendance:read', group: WORK },
  { key: 'teaching', label: 'Teaching logs', href: MODULE_PATHS.teaching, permission: 'academic:classes:read', group: WORK },
  { key: 'curriculum', label: 'Curriculum', href: MODULE_PATHS.curriculum, permission: 'academic:courses:read', group: WORK },
  { key: 'assessments', label: 'Assessments', href: MODULE_PATHS.assessments, permission: 'academic:assessments:read', group: WORK },
  { key: 'reviews', label: 'Student reviews', href: MODULE_PATHS.reviews, permission: 'academic:reviews:read', group: WORK },
  ...workNav(MODULE.basePath).flatMap((r) => (r.key === 'tasks' || r.key === 'eod' ? [{ ...r, key: r.key as Section, group: WORK }] : [])),
  { key: 'teachers', label: 'Teachers', href: MODULE_PATHS.teachers, permission: 'academic:assignments:read', group: COORDINATION },
  { key: 'enrolments', label: 'Enrolments', href: MODULE_PATHS.enrolments, permission: 'academic:enrolments:read', group: COORDINATION },
  { key: 'intake', label: 'Enrolment intake', href: MODULE_PATHS.intake, permission: 'academic:enrolments:read', group: COORDINATION },
  { key: 'progress', label: 'Progress and support', href: MODULE_PATHS.progress, permission: 'academic:progress:read', group: COORDINATION },
  { key: 'reports', label: 'Reports', href: MODULE_PATHS.reports, permission: 'academic:summary:read', group: COORDINATION },
  { key: 'settings', label: 'Academic settings', href: MODULE_PATHS.settings, permission: 'academic:settings:manage', group: COORDINATION },
];

/** Sidebar items for this user (cosmetic: every page and route checks again on the server). */
export function navFor(user: AuthenticatedUser, active?: Section) {
  return NAV.flatMap((n) => {
    const scope = scopeFor(user, n.permission);
    if (!scope || (n.group === COORDINATION && scope !== 'all')) return [];
    return [{ href: n.href, label: scope === 'own' && n.ownLabel ? n.ownLabel : n.label, group: n.group, active: n.key === active }];
  });
}

/** Absolute link into another workspace (D-072), or null when the user is not a member and would be bounced. */
export function workspaceLink(user: AuthenticatedUser, workspace: WorkspaceKey, path: string): string | null {
  return workspacesFor(user).includes(workspace) ? `${workspaceHrefs()[workspace]}${path}` : null;
}

export const TIMETABLE_TABS = [
  [MODULE_PATHS.timetable, 'Agenda'],
  [`${MODULE_PATHS.timetable}?view=week`, 'Week'],
  [MODULE_PATHS.patterns, 'Patterns'],
] as const;

export const CURRICULUM_TABS = [
  [MODULE_PATHS.curriculum, 'Courses and plans'],
  [MODULE_PATHS.conceptBooks, 'Concept-book indices'],
] as const;

/** requirePageAccess with the module's login path and basePath (browser paths, D-022). */
export function gate(permission: Permission, returnTo: string): Promise<PageAccess> {
  return requirePageAccess(permission, { loginPath: MODULE_PATHS.login, returnTo, basePath: MODULE.basePath, workspace: MODULE.key });
}

export function actorFor(user: AuthenticatedUser): Actor {
  return { user };
}

/** Unread in-app notifications for the top bar; null (hidden) when unknown. */
async function unreadFor(access: PageAccess): Promise<number | null> {
  if (!can(access.user, 'platform:notifications:read')) return null;
  try {
    return await countUnread(getDb(), access.user.id);
  } catch {
    return null;
  }
}

/** Children render inside <Suspense> (fallback: loading). Call gate() before rendering this so the 307 is real (D-022). */
export async function AcademicShell({ access, active, loading, children }: { access: PageAccess; active: Section; loading?: string; children: ReactNode }) {
  const user = access.user;
  return (
    <AppShell
      user={user}
      modules={access.modules}
      moduleHrefs={workspaceHrefs()}
      current="academic"
      logoutAction={MODULE_PATHS.logoutApi}
      nav={navFor(user, active)}
      search={can(user, 'academic:students:read') ? { action: MODULE_PATHS.students, label: 'Search students' } : undefined}
      unreadNotifications={await unreadFor(access)}
    >
      {access.status === 'forbidden' ? (
        <ErrorState level={1} title="No access to this page" description="Your roles do not include the permission this page needs. Ask an academic coordinator or a platform administrator." />
      ) : (
        <Suspense fallback={<LoadingState label={loading} />}>{children}</Suspense>
      )}
    </AppShell>
  );
}

/** Render a load failure honestly (never as empty data). Only AppError 4xx messages are shown; anything else stays generic (6.6). */
export function LoadError({ error }: { error: unknown }) {
  if (error instanceof AppError && error.status < 500) {
    return <ErrorState title={error.code === 'NOT_FOUND' ? 'Not found' : 'Could not load this page'} description={error.message} />;
  }
  console.error('academic page load failed', error);
  return <ErrorState title="Could not load this page" description="The data could not be loaded. Try again; if it keeps happening, tell a platform administrator." />;
}

/** Run a loader; return either its data or the error, so pages can render an ErrorState. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
