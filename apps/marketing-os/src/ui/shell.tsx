/**
 * Page frame for Marketing OS screens: server-side permission check (requirePageAccess),
 * AppShell with module navigation, forbidden state, notices from server actions, and a
 * Suspense boundary so every screen shows a loading state while its data loads.
 */
import { Suspense, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, type Permission, type Principal } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { requirePageAccess, workspaceHrefs } from '@elevate/server-kit/next';
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

type NavEntry = {
  key: string;
  label: string;
  /** Null = hidden slot. */
  path: string | null;
  permission: Permission;
};

/** Sidebar, in the order a marketing manager works. Every item is filtered by its permission. */
const NAV: readonly NavEntry[] = [
  { key: 'overview', label: 'Overview', path: '', permission: 'marketing:module:access' },
  // Leads, follow-ups, tasks and EOD are Business Ops screens mounted from its shared entries.
  { key: 'leads', label: 'Leads', path: 'leads', permission: 'ops:leads:read' },
  { key: 'follow-ups', label: 'Follow-ups', path: 'follow-ups', permission: 'ops:leads:read' },
  { key: 'campaigns', label: 'Campaigns', path: 'campaigns', permission: 'marketing:content:read' },
  {
    key: 'calendar',
    label: 'Content Calendar',
    path: 'calendar',
    permission: 'marketing:content:read',
  },
  // Hidden: every events service needs ops:appointments:*, which also covers private
  // counselling; Events and Webinars waits for a new owner-approved permission.
  { key: 'events', label: 'Events and Webinars', path: null, permission: 'ops:leads:read' },
  { key: 'tasks', label: 'Tasks', path: 'tasks', permission: 'ops:tasks:read' },
  { key: 'eod', label: 'EOD Reports', path: 'tasks?tab=eod', permission: 'ops:tasks:read' },
  {
    key: 'reports',
    label: 'Reports',
    path: 'metrics/weekly',
    permission: 'marketing:metrics:read',
  },
];

/** Area tabs under the page title, by nav key (pages that are not in the sidebar live here). */
const TABS: Partial<Record<string, readonly Omit<NavEntry, 'key'>[]>> = {
  leads: [
    { label: 'Leads', path: 'leads', permission: 'ops:leads:read' },
    { label: 'Follow-ups', path: 'follow-ups', permission: 'ops:leads:read' },
  ],
  campaigns: [
    { label: 'Campaigns', path: 'campaigns', permission: 'marketing:content:read' },
    { label: 'Accounts', path: 'accounts', permission: 'marketing:accounts:read' },
  ],
  calendar: [
    { label: 'Calendar', path: 'calendar', permission: 'marketing:content:read' },
    { label: 'Ideas', path: 'ideas', permission: 'marketing:ideas:read' },
  ],
  reports: [
    { label: 'Weekly report', path: 'metrics/weekly', permission: 'marketing:metrics:read' },
    { label: 'Metrics import', path: 'metrics/import', permission: 'marketing:metrics:read' },
  ],
};

const allowed = <T extends { path: string | null; permission: Permission }>(
  user: Principal,
  items: readonly T[],
) => items.filter((n): n is T & { path: string } => n.path !== null && can(user, n.permission));

/** Sidebar items this user may open (hiding is presentation; every page re-checks on the server). */
export function navFor(user: Principal, active: string): NavItem[] {
  return allowed(user, NAV).map((n) => ({
    href: modulePath(n.path),
    label: n.label,
    active: n.key === active,
  }));
}

/** Tabs of the area `active` that this user may open, as [href, label]. */
export function tabsFor(user: Principal, active: string): [string, string][] {
  return allowed(user, TABS[active] ?? []).map((t) => [modulePath(t.path), t.label]);
}

/** "Rules & settings" is reached from the Settings link at the bottom of the sidebar. */
const SETTINGS = { key: 'settings', label: 'Rules & settings', path: 'settings' };

/** Unread in-app notifications for the top bar; null (hidden) when unknown. */
async function unreadFor(user: AuthenticatedUser): Promise<number | null> {
  if (!can(user, 'platform:notifications:read')) return null;
  try {
    return await countUnread(getDb(), user.id);
  } catch {
    return null;
  }
}

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
  actions?: ReactNode;
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
  const currentTab = tabs.find(
    ([href]) => props.path === href || props.path.startsWith(`${href}/`),
  );
  const notice = props.searchParams ? param(props.searchParams, 'notice') : undefined;
  const error = props.searchParams ? param(props.searchParams, 'error') : undefined;
  const onSettings = props.active === SETTINGS.key;
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
              { label: SETTINGS.label, href: modulePath(SETTINGS.path) },
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
              actions={props.actions}
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
  let failure: string | null = null;
  try {
    node = await load();
  } catch (error) {
    failure = isAppError(error) ? error.message : 'The data could not be loaded.';
  }
  if (failure !== null) return <ErrorState description={failure} />;
  return <>{node}</>;
}
