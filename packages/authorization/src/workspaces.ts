import { MODULES, type ModuleKey } from '@elevate/shared-types';
import { can } from './catalogue';
import type { Permission } from './catalogue';
import type { Principal } from './types';

/**
 * Role workspaces (D-072). Each is one module app on its own origin. Membership is not a
 * separate list: a person belongs to a workspace when one of their stored roles grants
 * `<workspace>:module:access`. The port someone opens never grants anything.
 */
export const WORKSPACE_KEYS = [
  'ops',
  'academic',
  'marketing',
] as const satisfies readonly ModuleKey[];
export type WorkspaceKey = (typeof WORKSPACE_KEYS)[number];

export function isWorkspaceKey(value: unknown): value is WorkspaceKey {
  return typeof value === 'string' && (WORKSPACE_KEYS as readonly string[]).includes(value);
}

export function workspacesFor(principal: Principal | null | undefined): WorkspaceKey[] {
  return WORKSPACE_KEYS.filter((k) => can(principal, `${k}:module:access` as Permission));
}

export type Landing =
  /** Stay on the current app at this browser path. */
  | { kind: 'here'; path: string }
  /** Go to another workspace's home (its configured origin). */
  | { kind: 'workspace'; workspace: WorkspaceKey }
  /** Several workspaces and no remembered choice (or none at all): show the chooser. */
  | { kind: 'choose' };

const inBase = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`);

/**
 * Where a signed-in user goes after signing in on (or opening) app `current`:
 * 1. a workspace they belong to keeps them (at `next` when it is inside that workspace);
 * 2. otherwise their remembered workspace, if they still belong to it;
 * 3. otherwise their only workspace;
 * 4. otherwise the chooser (several workspaces, or none).
 * The platform app keeps an explicit `next` and is home for people with no workspace.
 * `next` must already be a safe relative path (safeRelativePath).
 */
export function resolveLanding(input: {
  workspaces: readonly WorkspaceKey[];
  preferred: string | null | undefined;
  current: ModuleKey;
  next?: string;
}): Landing {
  const { workspaces, preferred, current, next } = input;
  const base = MODULES[current].basePath;
  if (current === 'platform') {
    if (next && next !== '/') return { kind: 'here', path: next };
  } else if (workspaces.includes(current)) {
    return { kind: 'here', path: next && inBase(next, base) ? next : base };
  }
  if (isWorkspaceKey(preferred) && workspaces.includes(preferred))
    return { kind: 'workspace', workspace: preferred };
  if (workspaces.length === 1) return { kind: 'workspace', workspace: workspaces[0]! };
  if (current === 'platform' && workspaces.length === 0) return { kind: 'here', path: '/' };
  return { kind: 'choose' };
}
