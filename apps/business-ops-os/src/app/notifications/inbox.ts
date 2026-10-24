/** The signed-in person's in-app notifications (brief §9): one page, newest first; own rows only. */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  notifications,
  opsStaffTasks as tasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  countUnread,
  loadNotificationPreferences,
  markNotificationsRead,
} from '@elevate/notifications';
import type { NotificationId, UserId } from '@elevate/shared-types';

export const PAGE_SIZE = 25;

export const inboxQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const markReadBody = z
  .object({
    ids: z
      .array(z.uuid().transform((v) => v as NotificationId))
      .max(200)
      .optional(),
    all: z.literal(true).optional(),
  })
  .refine((b) => b.all || b.ids?.length, { error: 'Send the ids to mark, or all: true.' });

export async function inboxPage(db: Database, userId: UserId, page = 1) {
  const mine = eq(notifications.userId, userId);
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(mine);
  const items = await db
    .select()
    .from(notifications)
    .where(mine)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  // A task notification shows the task's states while the reader still owns the task (NOTIFY).
  const taskIds = [
    ...new Set(
      items.flatMap((n) => (n.entityType === 'staff_task' && n.entityId ? [n.entityId] : [])),
    ),
  ];
  const states = taskIds.length
    ? await db
        .select({
          id: tasks.id,
          deliveredAt: tasks.deliveredAt,
          acknowledgedAt: tasks.acknowledgedAt,
          lastSubmittedAt: tasks.lastSubmittedAt,
          approvedAt: tasks.approvedAt,
        })
        .from(tasks)
        .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
        .where(
          and(
            inArray(tasks.id, taskIds as (typeof tasks.$inferSelect.id)[]),
            eq(staffMembers.userId, userId),
          ),
        )
    : [];
  const prefs = (await loadNotificationPreferences(db, [userId])).get(userId)!;
  return {
    items: items.map((n) => ({ ...n, task: states.find((t) => t.id === n.entityId) ?? null })),
    total,
    unread: await countUnread(db, userId),
    page,
    pageSize: PAGE_SIZE,
    /** Personal setting: false = no toasts (the bell and this list still show everything). */
    popUps: prefs.popUps,
  };
}

/** `markNotificationsRead` only touches the owner's rows, so another person's id changes nothing. */
export async function markRead(db: Database, userId: UserId, body: z.infer<typeof markReadBody>) {
  const marked = await markNotificationsRead(db, userId, body.all ? 'all' : (body.ids ?? []));
  return { marked, unread: await countUnread(db, userId) };
}
