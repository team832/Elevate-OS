/**
 * Links that someone opens later (notifications) must land in a workspace they belong to (D-073):
 * the shared task/EOD and lead screens are hosted by several workspaces, so each recipient gets
 * the browser path in their own one. Stored links stay relative (notifications CHECK);
 * `linkUrl` turns one into an absolute URL for a page on another origin.
 */
import { loadRoles } from '@elevate/authentication';
import { workspacesFor, type WorkspaceKey } from '@elevate/authorization';
import { appOrigin } from '@elevate/configuration/workspaces';
import { opsStaffTasks, opsTaskEvents, type Database } from '@elevate/database';
import { eq } from 'drizzle-orm';
import type { NotifyInput } from '@elevate/notifications';
import { MODULES, type UserId } from '@elevate/shared-types';
import { deadlineText } from '../domain/staff-tasks';
import { userIdsForStaff, type Actor } from './context';
import { notifyOthers } from './ops-common';
import type { TaskRow } from './task-store';

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

/** `notifyHosted` to staff (people without a login are skipped), linking to the task. */
export async function notifyStaff(
  tx: Database,
  actor: Actor,
  staffIds: readonly (string | null | undefined)[],
  taskId: string,
  input: { kind: string; title: string; body?: string | null },
) {
  const users = await userIdsForStaff(tx, staffIds);
  await notifyHosted(tx, actor, users, 'work', `/tasks/${taskId}`, {
    ...input,
    entityType: 'staff_task',
    entityId: taskId,
  });
}

/**
 * Brief §9: deliver an assigned task to its owner — an in-app notification linking into their
 * own workspace (Academic for teachers, Marketing for marketers; never a forced redirect),
 * `delivered_at` and a `delivered` event. Not delivered (null) when the owner has no login or
 * is the caller. Delivery is not acknowledgement.
 */
export async function deliverTask(tx: Database, actor: Actor, row: TaskRow): Promise<TaskRow> {
  const [owner] = await userIdsForStaff(tx, [row.staffId]);
  if (!owner || owner === actor.id) return row;
  const now = new Date();
  await notifyStaff(tx, actor, [row.staffId], row.id, {
    kind: 'task.assigned',
    title: `New task: ${row.title}`,
    body: `Due ${deadlineText(row.dueOn, row.dueTime)}.${row.expectedDeliverable ? ` Deliverable: ${row.expectedDeliverable}` : ''}`,
  });
  const [after] = await tx
    .update(opsStaffTasks)
    .set({ deliveredAt: now })
    .where(eq(opsStaffTasks.id, row.id))
    .returning();
  await tx
    .insert(opsTaskEvents)
    .values({ taskId: row.id, kind: 'delivered', actorUserId: actor.id, occurredAt: now });
  return after!;
}
