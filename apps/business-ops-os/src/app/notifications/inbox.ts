/** The signed-in person's in-app notifications (brief §9): one page, newest first; own rows only. */
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { notifications, type Database } from '@elevate/database';
import { countUnread, markNotificationsRead } from '@elevate/notifications';
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
  return { items, total, unread: await countUnread(db, userId), page, pageSize: PAGE_SIZE };
}

/** `markNotificationsRead` only touches the owner's rows, so another person's id changes nothing. */
export async function markRead(db: Database, userId: UserId, body: z.infer<typeof markReadBody>) {
  const marked = await markNotificationsRead(db, userId, body.all ? 'all' : (body.ids ?? []));
  return { marked, unread: await countUnread(db, userId) };
}
