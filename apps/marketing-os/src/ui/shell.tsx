/**
 * Page frame for Marketing OS screens: server-side permission check (requirePageAccess),
 * AppShell with module navigation, forbidden state, notices from server actions, and a
 * Suspense boundary so every screen shows a loading state while its data loads.
 */
import { Suspense, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import type { Permission } from '@elevate/authorization';
import { requirePageAccess } from '@elevate/server-kit/next';
import { isAppError } from '@elevate/shared-contracts';
import {
  Alert,
  AppShell,
  ErrorState,
  LoadingState,
  PageHeader,
  type NavItem,
} from '@elevate/shared-ui';
import { MODULE, modulePath } from '../domain';
import { MODULE_PATHS } from '../server/paths';

const NAV: { key: string; label: string; path: string }[] = [
  { key: 'dashboard', label: 'Dashboard', path: '' },
  { key: 'accounts', label: 'Accounts', path: 'accounts' },
  { key: 'ideas', label: 'Ideas', path: 'ideas' },
  { key: 'calendar', label: 'Calendar', path: 'calendar' },
  { key: 'metrics-import', label: 'Metrics import', path: 'metrics/import' },
  { key: 'weekly', label: 'Weekly report', path: 'metrics/weekly' },
  { key: 'campaigns', label: 'Campaigns', path: 'campaigns' },
  { key: 'settings', label: 'Rules & settings', path: 'settings' },
];

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
    active: n.key === props.active,
  }));
  const notice = props.searchParams ? param(props.searchParams, 'notice') : undefined;
  const error = props.searchParams ? param(props.searchParams, 'error') : undefined;
  return (
    <AppShell
      user={access.user}
      modules={access.modules}
      current="marketing"
      logoutAction={MODULE_PATHS.logoutApi}
      nav={nav}
    >
      {access.status === 'forbidden' ? (
        <ErrorState
          title="No access"
          description={`Your roles do not include ${props.permission}. Ask a platform administrator if you need it.`}
        />
      ) : (
        <>
          <PageHeader title={props.title} description={props.description} actions={props.actions} />
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
