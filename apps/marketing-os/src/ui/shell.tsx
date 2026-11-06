/**
 * Page frame for Marketing OS screens: server-side permission check (requirePageAccess),
 * AppShell with module navigation, forbidden state, notices from server actions, and a
 * Suspense boundary so every screen shows a loading state while its data loads.
 */
import { Suspense, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, type Permission, type Principal } from '@elevate/authorization';
import { toAppError } from '@elevate/server-kit';
import { requirePageAccess, unreadFor, workspaceHrefs } from '@elevate/server-kit/next';
import { isAppError } from '@elevate/shared-contracts';
import {
  Alert,
  AppShell,
  ErrorState,
  LoadingState,
  PageHeader,
  Subnav,
  type NavItem,
} from '@elevate/shared-ui';
import { MODULE, modulePath } from '../domain';
import { MODULE_PATHS } from '../server/paths';
import { teamWide } from '../server/scope';
import { SessionGuard } from './session-guard';

type NavEntry = {
  key: string;
  label: string;
  /** Null = hidden slot. */
  path: string | null;
  permission: Permission;
  /** `team` = managers, director, auditor (all campaigns); `own` = marketing employees. Omitted = both. */
  audience?: 'team' | 'own';
  group?: string;
};

const inGroup = (group: string, entries: NavEntry[]) => entries.map((e) => ({ ...e, group }));

/**
 * Sidebar = the site map (Blueprint step 3, 6 Nov 2026), grouped, for managers and marketing
 * employees alike; employees get their own-scope pages. Every item is also filtered by its
 * permission; pages re-check on the server. Settings is the link at the foot of the sidebar.
 */
export const NAV: readonly NavEntry[] = [
  ...inGroup('Today', [
    // Employees land on My day; the module-wide Overview is for managers.
    {
      key: 'overview',
      label: 'Overview',
      path: '',
      permission: 'marketing:module:access',
      audience: 'team',
    },
    { key: 'my-day', label: 'My day', path: 'my-day', permission: 'marketing:module:access' },
  ]),
  // Leads, follow-ups, tasks and work reports are Business Ops screens mounted from its shared entries.
  ...inGroup('Leads', [
    { key: 'leads', label: 'Leads', path: 'leads', permission: 'ops:leads:read' },
    {
      key: 'follow-ups',
      label: 'Calls and follow-ups',
      path: 'sales-calls',
      permission: 'ops:leads:read',
    },
  ]),
  ...inGroup('Plan and make', [
    {
      key: 'campaigns',
      label: 'Campaigns',
      path: 'campaigns',
      permission: 'marketing:campaigns:read',
    },
    {
      key: 'calendar',
      label: 'Marketing calendar',
      path: 'calendar',
      permission: 'marketing:calendar:read',
    },
    { key: 'ideas', label: 'Ideas', path: 'ideas', permission: 'marketing:ideas:read' },
    {
      key: 'deliverables',
      label: 'Content and deliverables',
      path: 'deliverables',
      permission: 'marketing:module:access',
    },
  ]),
  ...inGroup('Results', [
    {
      key: 'optimisation',
      label: 'SEO / AIO / GEO',
      path: 'optimisation',
      permission: 'marketing:optimisation:read',
    },
    { key: 'targets', label: 'Targets', path: 'targets', permission: 'marketing:targets:read' },
    {
      key: 'reports',
      label: 'Reports',
      path: 'metrics/weekly',
      permission: 'marketing:metrics:read',
    },
  ]),
  ...inGroup('My work', [
    { key: 'tasks', label: 'My tasks', path: 'tasks', permission: 'ops:tasks:read' },
    {
      key: 'my-attendance',
      label: 'My attendance and leave',
      path: 'my-attendance',
      permission: 'ops:attendance:read',
    },
    {
      key: 'my-payslips',
      label: 'My payslips',
      path: 'my-payslips',
      permission: 'ops:payslips:read',
    },
    { key: 'my-reports', label: 'My reports', path: 'my-reports', permission: 'ops:tasks:read' },
    {
      key: 'hr-requests',
      label: 'Requests to HR',
      path: 'hr-requests',
      permission: 'ops:hr_requests:create',
    },
  ]),
];

/** Pages without their own sidebar item light up the item they belong to. */
const PARENT: Partial<Record<string, string>> = {
  'my-campaigns': 'campaigns',
  'team-review': 'tasks',
  eod: 'my-reports',
  content: 'deliverables',
  'personal-settings': 'settings',
};

/** Area tabs under the page title, by nav key (pages that are not in the sidebar live here). */
const TABS: Partial<Record<string, readonly Omit<NavEntry, 'key'>[]>> = {
  leads: [
    { label: 'Leads', path: 'leads', permission: 'ops:leads:read' },
    { label: 'Lead stages', path: 'leads/stages', permission: 'ops:leads:read' },
    { label: 'Lead sharing', path: 'leads/sharing', permission: 'ops:leads:assign' },
  ],
  'follow-ups': [
    { label: 'Sales calls', path: 'sales-calls', permission: 'ops:leads:read' },
    { label: 'Follow-ups', path: 'follow-ups', permission: 'ops:leads:read' },
  ],
  campaigns: [
    { label: 'Campaigns', path: 'campaigns', permission: 'marketing:campaigns:read' },
    { label: 'Assigned to me', path: 'my-campaigns', permission: 'marketing:campaigns:read' },
    { label: 'Accounts', path: 'accounts', permission: 'marketing:accounts:read' },
  ],
  reports: [
    { label: 'Weekly report', path: 'metrics/weekly', permission: 'marketing:metrics:read' },
    { label: 'Metrics import', path: 'metrics/import', permission: 'marketing:metrics:read' },
    { label: 'Monthly report', path: 'reports/monthly', permission: 'marketing:reports:read' },
  ],
  settings: [
    { label: 'Rules and settings', path: 'settings', permission: 'marketing:module:access' },
    {
      label: 'Personal settings',
      path: 'settings/personal',
      permission: 'marketing:module:access',
    },
  ],
};

const allowed = <T extends { path: string | null; permission: Permission }>(
  user: Principal,
  items: readonly T[],
) => items.filter((n): n is T & { path: string } => n.path !== null && can(user, n.permission));

/** Sidebar items this user may open (hiding is presentation; every page re-checks on the server). */
export function navFor(user: Principal, active: string): NavItem[] {
  const audience = teamWide(user) ? 'team' : 'own';
  return allowed(
    user,
    NAV.filter((n) => !n.audience || n.audience === audience),
  ).map((n) => ({
    href: modulePath(n.path),
    label: n.label,
    group: n.group,
    active: n.key === (PARENT[active] ?? active),
  }));
}

/** Tabs of the area `active` that this user may open, as [href, label]. */
export function tabsFor(user: Principal, active: string): [string, string][] {
  return allowed(user, TABS[PARENT[active] ?? active] ?? []).map((t) => [
    modulePath(t.path),
    t.label,
  ]);
}

/** Settings (Rules and settings, Personal settings) is the link at the bottom of the sidebar. */
const SETTINGS = { key: 'settings', path: 'settings' };

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

export interface MarketingPageProps {
  permission: Permission;
  /** Browser path to return to after sign-in, e.g. modulePath('ideas'). */
  path: string;
  active: string;
  /** Omit for a shared Business Ops body, which renders its own PageHeader. */
  title?: string;
  description?: ReactNode;
  actions?: ReactNode | ((user: AuthenticatedUser) => ReactNode);
  searchParams?: Record<string, string | string[] | undefined>;
  children: (user: AuthenticatedUser) => ReactNode;
}

export async function MarketingPage(props: MarketingPageProps) {
  const access = await requirePageAccess(props.permission, {
    loginPath: MODULE_PATHS.login,
    returnTo: props.path,
    basePath: MODULE.basePath,
    workspace: MODULE.key,
  });
  const user = access.user;
  const nav = navFor(user, props.active);
  const tabs = tabsFor(user, props.active);
  // The exact tab first: Settings › Personal settings also starts with the Settings path.
  const currentTab =
    tabs.find(([href]) => props.path === href) ??
    tabs.find(([href]) => props.path.startsWith(`${href}/`));
  const notice = props.searchParams ? param(props.searchParams, 'notice') : undefined;
  const error = props.searchParams ? param(props.searchParams, 'error') : undefined;
  const onSettings = (PARENT[props.active] ?? props.active) === SETTINGS.key;
  return (
    <AppShell
      user={user}
      modules={access.modules}
      moduleHrefs={workspaceHrefs()}
      current="marketing"
      logoutAction={MODULE_PATHS.logoutApi}
      nav={nav}
      breadcrumbs={
        onSettings
          ? [
              { label: 'Marketing OS', href: MODULE.basePath },
              { label: props.title ?? 'Settings', href: props.path },
            ]
          : undefined
      }
      search={
        can(user, 'marketing:ideas:read')
          ? { action: modulePath('ideas'), label: 'Search ideas' }
          : undefined
      }
      settings={
        can(user, 'marketing:module:access')
          ? { href: modulePath(SETTINGS.path), active: onSettings }
          : undefined
      }
      unreadNotifications={await unreadFor(user)}
    >
      <SessionGuard check={MODULE_PATHS.sessionApi} signIn={MODULE_PATHS.login} />
      {access.status === 'forbidden' ? (
        <ErrorState
          level={1}
          title="No access"
          description="Your roles do not include the permission this page needs. Ask a platform administrator if you need it."
        />
      ) : (
        <>
          {props.title ? (
            <PageHeader
              title={props.title}
              description={props.description}
              actions={typeof props.actions === 'function' ? props.actions(user) : props.actions}
              tabs={
                tabs.length > 1 ? (
                  <Subnav label={props.title} items={tabs} current={currentTab?.[0]} />
                ) : undefined
              }
            />
          ) : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {error ? (
            <Alert tone="danger" title="That did not work">
              {error}
            </Alert>
          ) : null}
          <Suspense
            fallback={<LoadingState label={`Loading ${props.title?.toLowerCase() ?? 'page'}…`} />}
          >
            {props.children(access.user)}
          </Suspense>
        </>
      )}
    </AppShell>
  );
}

/**
 * Render a data section; a failed load becomes an ErrorState (never a blank or a zero).
 * Only AppError messages (written for users) are shown; anything else stays generic.
 */
export async function Section({ load }: { load: () => Promise<ReactNode> }) {
  let node: ReactNode = null;
  let failure: { title?: string; description: string } | null = null;
  try {
    node = await load();
  } catch (error) {
    const known = toAppError(error);
    failure =
      isAppError(error) || known.status < 500
        ? {
            title:
              known.status === 404
                ? 'Not found'
                : known.status < 500
                  ? 'Cannot show this'
                  : undefined,
            description: known.message,
          }
        : { description: 'The data could not be loaded.' };
  }
  if (failure) return <ErrorState {...failure} />;
  return <>{node}</>;
}
