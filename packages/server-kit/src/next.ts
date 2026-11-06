/**
 * Helpers for Next.js server components (pages/layouts) —
 * `import { requirePageAccess } from '@elevate/server-kit/next'`.
 *
 * PATHS: callers always pass BROWSER paths (including the basePath, e.g.
 * `/marketing/login`). Next.js `redirect()` prepends the app's basePath itself,
 * so these helpers strip it first (`toAppPath`). Never call `redirect()` with a
 * basePath-prefixed path in a module app — it would become `/marketing/marketing/...`.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { landingLocation, type AuthenticatedUser } from '@elevate/authentication';
import { getCurrentUser } from '@elevate/authentication/next';
import {
  can,
  modulesFor,
  resolveLanding,
  workspacesFor,
  type Permission,
  type WorkspaceKey,
} from '@elevate/authorization';
import { appOrigin } from '@elevate/configuration/workspaces';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import { MODULE_KEYS, MODULES, type ModuleKey } from '@elevate/shared-types';
import { toAppPath } from './paths';

export { getCurrentUser } from '@elevate/authentication/next';
export { toAppPath } from './paths';

export type PageAccess =
  | { status: 'allowed'; user: AuthenticatedUser; modules: ModuleKey[] }
  | { status: 'forbidden'; user: AuthenticatedUser; modules: ModuleKey[] };

export interface PageAccessOptions {
  /** Browser path of the sign-in page, e.g. `/login` or `/marketing/login`. */
  loginPath: string;
  /** Browser path to come back to after signing in, e.g. `/marketing`. */
  returnTo: string;
  /** The app's basePath (`''` for the platform, `/marketing`, `/academic`, `/ops`). */
  basePath?: string;
  /**
   * The workspace this page belongs to (D-072). Someone whose roles do not grant
   * `<workspace>:module:access` is sent to their own workspace (or the chooser) before any
   * permission check, so opening another port never shows that workspace.
   */
  workspace?: WorkspaceKey;
}

/** The sign-in page, returning to this page with the query it was opened with (the proxy forwards it). */
async function signInPath({ loginPath, returnTo, basePath }: PageAccessOptions) {
  const search = returnTo.includes('?') ? '' : ((await headers()).get('x-return-search') ?? '');
  return `${toAppPath(loginPath, basePath)}?next=${encodeURIComponent(returnTo + search)}`;
}

/**
 * For a page that needs `permission`:
 * - not signed in → 307 redirect to `loginPath?next=<returnTo>`
 * - signed in without the permission → `{ status: 'forbidden' }` (render an ErrorState; do not leak data)
 * - otherwise `{ status: 'allowed', user, modules }`.
 * Do not put `loading.tsx` at the app root: a Suspense boundary above the page
 * turns this redirect into a streamed 200 + client-side refresh.
 */
export async function requirePageAccess(
  permission: Permission,
  options: PageAccessOptions,
): Promise<PageAccess> {
  const user = await getCurrentUser();
  if (!user) redirect(await signInPath(options));
  if (options.workspace && !can(user, `${options.workspace}:module:access` as Permission)) {
    const landing = resolveLanding({
      workspaces: workspacesFor(user),
      preferred: user.preferredWorkspace,
      current: options.workspace,
    });
    const to = landingLocation(landing, options.workspace);
    redirect(landing.kind === 'workspace' ? to : toAppPath(to, options.basePath));
  }
  const modules = modulesFor(user);
  return can(user, permission)
    ? { status: 'allowed', user, modules }
    : { status: 'forbidden', user, modules };
}

/** A module app's `gate(permission, returnTo)`: `requirePageAccess` with its fixed options. */
export const pageGate =
  (app: Omit<PageAccessOptions, 'returnTo'>) =>
  (permission: Permission, returnTo: string): Promise<PageAccess> =>
    requirePageAccess(permission, { ...app, returnTo });

/** Unread in-app notifications for the top bar; null (indicator hidden) when not allowed or unknown. */
export async function unreadFor(user: AuthenticatedUser): Promise<number | null> {
  if (!can(user, 'platform:notifications:read')) return null;
  try {
    return await countUnread(getDb(), user.id);
  } catch {
    return null;
  }
}

/**
 * Redirect from a server action. Next adds the basePath when scripts sent the form (`next-action`
 * header), but a plain form post before scripts have run gets the path as written, so the browser
 * path is what that case needs. Always `return` this: it is what stops the action.
 */
export async function actionRedirect(browserPath: string, basePath = ''): Promise<never> {
  const scripted = (await headers()).has('next-action');
  redirect(scripted ? toAppPath(browserPath, basePath) : browserPath);
}

/** Absolute URL of every app's home, for the shell's workspace switcher (D-072). */
export function workspaceHrefs(): Record<ModuleKey, string> {
  return Object.fromEntries(
    MODULE_KEYS.map((k) => [k, `${appOrigin(k)}${MODULES[k].basePath}`]),
  ) as Record<ModuleKey, string>;
}

/** Signed-in user or a redirect to the sign-in page (paths as in `requirePageAccess`). */
export async function requireUser(options: PageAccessOptions): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect(await signInPath(options));
  return user;
}

/** The request id forwarded by the proxy, if any (for error screens). */
export async function currentRequestId(): Promise<string | undefined> {
  return (await headers()).get('x-request-id') ?? undefined;
}
