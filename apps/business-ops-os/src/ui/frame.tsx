/**
 * Page frame for every Business Ops screen: server-side access check
 * (requirePageAccess, before any Suspense boundary so signed-out visitors get a
 * real 307), AppShell with the module navigation, and helpers for the four
 * screen states (loading via <Suspense>, empty, error, success).
 */
import { Suspense, type ReactNode } from 'react';
import { can, scopeFor, type Permission } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { AppError } from '@elevate/shared-contracts';
import {
  currentRequestId,
  requirePageAccess,
  workspaceHrefs,
  type PageAccess,
} from '@elevate/server-kit/next';
import { AppShell, ButtonLink, ErrorState, LoadingState, type Crumb } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import { searchable } from '../server/search';
import { SearchShortcut } from './global-search';

/**
 * [key, label, href, permission, page keys (Frame `active`) that light this item up, needs the
 * permission at `all` scope (own-scope holders, e.g. staff reading their own attendance, do not
 * get the HR list)].
 */
type NavRow = [
  key: string,
  label: string,
  href: string,
  permission: Permission,
  also?: string[],
  allScope?: boolean,
];
const section = (group: string | undefined, rows: NavRow[]) =>
  rows.map(([key, label, href, permission, also = [], allScope = false]) => ({
    key,
    label,
    href,
    permission,
    allScope,
    group,
    keys: new Set([key, ...also]),
  }));

/**
 * Module navigation (sidebar, owner brief 22 Oct 2026 §5): one item per area, each shown only
 * with its permission. Pages inside an area (Leads, Applications, Approvals, Staff directory,
 * Report inbox…) are reached from that area's tabs and light up its item. Settings is the link
 * at the bottom of the sidebar.
 */
export const NAV = [
  ...section(undefined, [['home', 'Overview', '/ops', 'ops:module:access']]),
  // Personal rows (own scope is enough): your own records, not the HR lists.
  ...section('My work', [
    ['my-attendance', 'My attendance', '/ops/my-attendance', 'ops:attendance:read'],
    ['my-reports', 'My reports', '/ops/my-reports', 'ops:tasks:read'],
    ['hr-requests', 'Requests through HR', '/ops/hr-requests', 'ops:hr_requests:create'], // HR-REQ
  ]),
  ...section('Admissions', [
    [
      'overview',
      'Admissions',
      '/ops/admissions/overview',
      'ops:admissions:read',
      ['applications', 'leads', 'meetings'],
    ],
    ['admissions', 'Demo Students', '/ops/admissions', 'ops:leads:read'],
  ]),
  ...section('Students', [
    ['students', 'Active Students', '/ops/students', 'ops:students:read'],
    ['past', 'Past Students', '/ops/students/past', 'ops:students:read'],
  ]),
  ...section('Money', [
    ['fees', 'Fees and Collections', '/ops/fees', 'ops:fees:read', ['approvals']],
  ]),
  ...section('Teaching and work', [
    ['teachers', 'Teachers', '/ops/teachers', 'ops:teachers:read', ['staff']],
    ['academic-summary', 'Academic Summary', '/ops/academic-summary', 'ops:dashboard:read'],
    ['tests', 'Tests and Mock Tests', '/ops/tests', 'ops:assessments:read'], // TESTS-OPS
    [
      'tasks',
      'Tasks and EOD Reports',
      '/ops/tasks',
      'ops:tasks:read',
      ['tasks-inbox', 'tasks-reports', 'tasks-imports'],
    ],
  ]),
  // HR (brief 23 Oct 2026 §6): each area page passes its key as Frame `active`.
  ...section('HR', [
    ['hr', 'HR Overview', '/ops/hr', 'ops:hr:read'],
    ['hr-staff', 'Staff Directory', '/ops/hr/staff', 'ops:hr:read'],
    [
      'hr-assignments',
      'Teaching Assignments',
      '/ops/hr/assignments',
      'ops:teaching_assignments:read',
    ],
    ['hr-attendance', 'Attendance', '/ops/hr/attendance', 'ops:attendance:read', [], true],
    ['hr-tasks', 'Tasks', '/ops/hr/tasks', 'ops:tasks:review'],
    ['hr-review', 'Submission Review', '/ops/hr/review', 'ops:tasks:review'],
    ['hr-requests-queue', 'Staff Requests', '/ops/hr/requests', 'ops:hr_requests:read'], // HR-REQ
    ['hr-reports', 'Work Reports', '/ops/hr/reports', 'ops:work_reports:read'],
    [
      'hr-feedback',
      'Student Feedback about Teachers',
      '/ops/hr/feedback',
      'ops:teacher_feedback:read',
    ],
    ['hr-settings', 'HR Settings', '/ops/hr/settings', 'ops:hr_settings:manage'],
  ]),
  ...section('Insight', [
    ['marketing-summary', 'Marketing Summary', '/ops/marketing-summary', 'ops:dashboard:read'],
    ['reports', 'Reports', '/ops/reports', 'ops:module:access'],
  ]),
];

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
    workspace: MODULE.key,
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
  const nav = NAV.filter((n) =>
    n.allScope ? scopeFor(user, n.permission) === 'all' : can(user, n.permission),
  ).map((n) => ({
    href: n.href,
    label: n.label,
    group: n.group,
    active: n.keys.has(active),
  }));
  const settingsPage = active === 'settings' && can(user, 'ops:settings:read');
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
      moduleHrefs={workspaceHrefs()}
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
        can(user, 'ops:settings:read') ? { href: '/ops/settings', active: settingsPage } : undefined
      }
      unreadNotifications={await unreadFor(access)}
    >
      {canSearch ? <SearchShortcut inputId="el-search-ops" /> : null}
      {access.status === 'forbidden' ? (
        <ErrorState
          level={1}
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
