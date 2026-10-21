/**
 * Page frame for Marketing OS screens: server-side permission check (requirePageAccess),
 * AppShell with module navigation, forbidden state, notices from server actions, and a
 * Suspense boundary so every screen shows a loading state while its data loads.
 */
import { Suspense, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, type Permission } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { requirePageAccess } from '@elevate/server-kit/next';
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

const NAV: { key: string; label: string; path: string; group: string }[] = [
  { key: 'dashboard', label: 'Dashboard', path: '', group: 'Plan' },
  { key: 'calendar', label: 'Calendar', path: 'calendar', group: 'Plan' },
  { key: 'campaigns', label: 'Campaigns', path: 'campaigns', group: 'Plan' },
  { key: 'ideas', label: 'Ideas', path: 'ideas', group: 'Content' },
  { key: 'accounts', label: 'Accounts', path: 'accounts', group: 'Accounts' },
  { key: 'weekly', label: 'Weekly report', path: 'metrics/weekly', group: 'Metrics' },
  { key: 'metrics-import', label: 'Metrics import', path: 'metrics/import', group: 'Metrics' },
];

/** Metrics area tabs: [href, label]. */
export const METRICS_TABS = [
  [modulePath('metrics/weekly'), 'Weekly report'],
  [modulePath('metrics/import'), 'Metrics import'],
] as const;

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
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Area tabs under the title (see `METRICS_TABS`). */
  tabs?: readonly (readonly [href: string, label: string])[];
  searchParams?: Record<string, string | string[] | undefined>;
  children: (user: AuthenticatedUser) => ReactNode;
}

export async function MarketingPage(props: MarketingPageProps) {
  const access = await requirePageAccess(props.permission, {
    loginPath: MODULE_PATHS.login,
    returnTo: props.path,
    basePath: MODULE.basePath,
  });
  const nav: NavItem[] = NAV.map((n) => ({
    href: modulePath(n.path),
    label: n.label,
    group: n.group,
    active: n.key === props.active,
  }));
  const notice = props.searchParams ? param(props.searchParams, 'notice') : undefined;
  const error = props.searchParams ? param(props.searchParams, 'error') : undefined;
  const user = access.user;
  const onSettings = props.active === SETTINGS.key;
  return (
    <AppShell
      user={user}
      modules={access.modules}
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
          title="No access"
          description="Your roles do not include the permission this page needs. Ask a platform administrator if you need it."
        />
      ) : (
        <>
          <PageHeader
            title={props.title}
            description={props.description}
            actions={props.actions}
            tabs={
              props.tabs ? (
                <Subnav
                  label={props.title}
                  items={props.tabs}
                  current={nav.find((n) => n.active)?.href}
                />
              ) : undefined
            }
          />
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {error ? (
            <Alert tone="danger" title="That did not work">
              {error}
            </Alert>
          ) : null}
          <Suspense fallback={<LoadingState label={`Loading ${props.title.toLowerCase()}…`} />}>
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
