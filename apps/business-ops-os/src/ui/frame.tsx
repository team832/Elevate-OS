/**
 * Page frame for every Business Ops screen: server-side access check
 * (requirePageAccess, before any Suspense boundary so signed-out visitors get a
 * real 307), AppShell with the module navigation, and helpers for the four
 * screen states (loading via <Suspense>, empty, error, success).
 */
import { Suspense, type ReactNode } from 'react';
import { can, scopeFor, type Principal } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { toAppError } from '@elevate/server-kit';
import {
  currentRequestId,
  pageGate,
  unreadFor,
  workspaceHrefs,
  type PageAccess,
} from '@elevate/server-kit/next';
import { AppShell, ButtonLink, ErrorState, LoadingState, type Crumb } from '@elevate/shared-ui';
import { MODULE } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import { searchable } from '../server/search';
import type { AnyOf } from './admissions-nav';
import { SearchShortcut } from './global-search';
import { PAGE_NEEDS } from './open-link';

/**
 * [key, label, href, permission (or a list, any one enough), page keys (Frame `active`) that light
 * this item up, needs the permission at `all` scope (own-scope holders, e.g. staff reading their
 * own attendance, do not get the HR list)].
 */
type NavRow = [
  key: string,
  label: string,
  href: string,
  permission: AnyOf,
  also?: string[],
  allScope?: boolean,
];
const section = (group: string, rows: NavRow[]) =>
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
 * Module navigation (site map, Blueprint step 3, 6 Nov 2026): grouped like the work, each item
 * shown with the permission its page checks (PAGE_NEEDS where the body needs more than the gate),
 * so nobody is sent to an empty or refused page.
 * Area tabs (ui/admissions-nav.tsx) reach the pages without an item (the admissions dashboard,
 * All staff, Sales calls, Lead stages…) and light up their item. Settings is the link at the foot.
 */
export const NAV = [
  ...section('Today', [
    ['home', 'Overview', '/ops', 'ops:module:access'],
    ['calendar', 'Calendar', '/ops/calendar', 'ops:module:access'],
  ]),
  ...section('Admissions', [
    ['leads', 'Leads', '/ops/leads', 'ops:leads:read'],
    ['follow-ups', 'Follow-ups', '/ops/follow-ups', 'ops:leads:read'],
    ['admissions', 'Demos', '/ops/admissions', 'ops:leads:read'],
    // The admission record (/ops/admissions/[id]) is where a confirmed application goes on.
    [
      'applications',
      'Applications',
      '/ops/admissions/applications',
      'ops:admissions:read',
      ['admission-record'],
    ],
    ['meetings', 'Counselling and events', '/ops/meetings', 'ops:appointments:read'],
  ]),
  ...section('Students', [
    ['students', 'Active students', '/ops/students', 'ops:students:read'],
    ['past', 'Past students', '/ops/students/past', 'ops:students:read'],
    ['absences', 'Absent students', '/ops/students/absences', 'ops:student_private:read'],
    ['certificates', 'Certificates', '/ops/certificates', 'ops:students:read'],
  ]),
  ...section('Fees', [
    ['fees', 'Fee structure', '/ops/fees', 'ops:fees:read'],
    ['fees-collections', 'Collections', '/ops/fees/collections', 'ops:fees:read'],
    ['fees-outstanding', 'Outstanding instalments', '/ops/fees/outstanding', 'ops:fees:read'],
    ['fees-defaulters', 'Overdue fees', '/ops/fees/defaulters', 'ops:fees:read'],
    [
      'approvals',
      'Fee approvals',
      '/ops/operations/approvals',
      PAGE_NEEDS['/ops/operations/approvals']!,
    ],
  ]),
  ...section('Teaching', [
    ['teachers', 'Teachers', '/ops/teachers', 'ops:teachers:read', ['staff']],
    ['tests', 'Tests and mock tests', '/ops/tests', 'ops:assessments:read'], // TESTS-OPS
  ]),
  // HR (brief 23 Oct 2026 §6): each area page passes its key as Frame `active`.
  ...section('Team (HR)', [
    ['hr', 'HR overview', '/ops/hr', 'ops:hr:read'],
    ['hr-staff', 'Staff directory', '/ops/hr/staff', 'ops:hr:read'],
    ['hr-checklists', 'Joining and leaving', '/ops/hr/checklists', 'ops:hr:read', ['hr-assets']],
    [
      'hr-assignments',
      'Teaching assignments',
      '/ops/hr/assignments',
      'ops:teaching_assignments:read',
    ],
    [
      'hr-attendance',
      'Attendance and leave',
      '/ops/hr/attendance',
      'ops:attendance:read',
      [],
      true,
    ],
    ['hr-payroll', 'Payroll', '/ops/hr/payroll', PAGE_NEEDS['/ops/hr/payroll']!],
    ['hr-review', 'Task review', '/ops/hr/review', 'ops:tasks:review', ['hr-tasks']],
    ['hr-requests-queue', 'Requests from staff', '/ops/hr/requests', 'ops:hr_requests:read'], // HR-REQ
    ['hr-reports', 'Work reports', '/ops/hr/reports', 'ops:work_reports:read'],
    [
      'hr-feedback',
      'Student feedback about teachers',
      '/ops/hr/feedback',
      'ops:teacher_feedback:read',
    ],
    ['hr-settings', 'HR settings', '/ops/hr/settings', 'ops:hr_settings:manage'],
  ]),
  ...section('Reports', [
    ['reports', 'Reports', '/ops/reports', PAGE_NEEDS['/ops/reports']!],
    ['academic-summary', 'Academic summary', '/ops/academic-summary', 'ops:dashboard:read'],
    ['marketing-summary', 'Marketing summary', '/ops/marketing-summary', 'ops:dashboard:read'],
  ]),
  // Personal rows (own scope is enough): your own records, not the HR lists.
  ...section('My work', [
    [
      'tasks',
      'Tasks and EOD reports',
      '/ops/tasks',
      'ops:tasks:read',
      ['tasks-inbox', 'tasks-reports', 'tasks-imports'],
    ],
    ['my-attendance', 'My attendance and leave', '/ops/my-attendance', 'ops:attendance:read'],
    ['my-payslips', 'My payslips', '/ops/my-payslips', 'ops:payslips:read'],
    ['my-reports', 'My reports', '/ops/my-reports', 'ops:tasks:read'],
    ['hr-requests', 'Requests to HR', '/ops/hr-requests', 'ops:hr_requests:create'], // HR-REQ
    ['approval-cover', 'Approval cover', '/ops/approval-cover', PAGE_NEEDS['/ops/approval-cover']!],
  ]),
];

/** Rail items this user may open, `active` lit (hiding is presentation; pages re-check). */
export const navFor = (user: Principal, active = '') =>
  NAV.filter((n) =>
    [n.permission].flat().some((p) => (n.allScope ? scopeFor(user, p) === 'all' : can(user, p))),
  ).map((n) => ({ href: n.href, label: n.label, group: n.group, active: n.keys.has(active) }));

export const gate = pageGate({
  loginPath: MODULE_PATHS.login,
  basePath: MODULE.basePath,
  workspace: MODULE.key,
});

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
      nav={navFor(user, active)}
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
      unreadNotifications={await unreadFor(user)}
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
  /** 1 when the failure replaces the whole page. */
  level?: 1 | 2,
): Promise<{ ok: true; data: T } | { ok: false; view: ReactNode }> {
  try {
    return { ok: true, data: await fn(getDb()) };
  } catch (error) {
    const requestId = await currentRequestId().catch(() => undefined);
    const known = toAppError(error);
    if (known.status < 500) {
      return {
        ok: false,
        view: (
          <ErrorState
            level={level}
            title={known.status === 404 ? 'Not found' : 'Cannot show this'}
            description={known.message}
            requestId={requestId}
          />
        ),
      };
    }
    console.error('ops page section failed', error);
    return { ok: false, view: <ErrorState level={level} requestId={requestId} action={retry} /> };
  }
}
