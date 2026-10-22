/**
 * Links that someone opens later (notifications) must land in a workspace they belong to (D-073):
 * the shared task/EOD and lead screens are hosted by several workspaces, so each recipient gets
 * the browser path in their own one. Stored links stay relative (notifications CHECK);
 * `linkUrl` turns one into an absolute URL for a page on another origin.
 */
import { loadRoles } from '@elevate/authentication';
import { workspacesFor, type WorkspaceKey } from '@elevate/authorization';
import { appOrigin } from '@elevate/configuration/workspaces';
import type { Database } from '@elevate/database';
import type { NotifyInput } from '@elevate/notifications';
import { MODULES, type UserId } from '@elevate/shared-types';
import type { Actor } from './context';
import { notifyOthers } from './ops-common';

/** Workspaces whose shell hosts each area, in preference order (Ops keeps its inbox and tools). */
export const HOSTS = {
  work: ['ops', 'academic', 'marketing'],
  leads: ['ops', 'marketing'],
  meetings: ['ops', 'academic'],
} as const satisfies Record<string, readonly WorkspaceKey[]>;
export type HostedArea = keyof typeof HOSTS;

/** `path` (e.g. `/tasks/<id>`) under the base of the first host of `area` the user belongs to. */
export async function linkFor(db: Database, userId: UserId, area: HostedArea, path: string) {
  const mine = workspacesFor({ id: userId, roles: await loadRoles(db, userId) });
  // No membership at all: Ops, whose sign-in sends them to "access pending".
  const key = HOSTS[area].find((k) => mine.includes(k)) ?? 'ops';
  return `${MODULES[key].basePath}${path}`;
}

/** Absolute URL of a stored workspace link (`/academic/tasks/…` → `http://…:3001/academic/tasks/…`). */
export function linkUrl(link: string): string {
  const key = HOSTS.work.find((k) => link.startsWith(`${MODULES[k].basePath}/`)) ?? 'ops';
  return `${appOrigin(key)}${link}`;
}

/** `notifyOthers`, with each recipient's link (`path` in `area`) in their own workspace. */
export async function notifyHosted(
  tx: Database,
  actor: Actor,
  userIds: readonly UserId[],
  area: HostedArea,
  path: string,
  input: Omit<NotifyInput, 'userIds' | 'module' | 'link'>,
) {
  for (const id of userIds)
    await notifyOthers(tx, actor, [id], { ...input, link: await linkFor(tx, id, area, path) });
}
