import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { notifications, type Database } from '@elevate/database';
import type { ModuleKey, NotificationId, UserId } from '@elevate/shared-types';

export interface NotifyInput {
  /** One or more recipients. */
  userIds: readonly UserId[];
  module: ModuleKey;
  /** Machine-readable kind, e.g. `approval.requested`, `enrolment.confirmed`. */
  kind: string;
  title: string;
  body?: string | null;
  /** Relative link inside Elevate OS, e.g. `/ops/admissions/<id>` (must start with `/`). */
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Write in-app notifications. Call inside the transaction of the change that
 * caused them so they appear only if it commits.
 */
export async function notify(tx: Database, input: NotifyInput): Promise<NotificationId[]> {
  const recipients = [...new Set(input.userIds)];
  if (recipients.length === 0) return [];
  if (input.link && !input.link.startsWith('/'))
    throw new Error('Notification links must be relative paths starting with "/"');
  const rows = await tx
    .insert(notifications)
    .values(
      recipients.map((userId) => ({
        userId,
        module: input.module,
        kind: input.kind,
        title: input.title.slice(0, 300),
        body: input.body ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
    )
    .returning({ id: notifications.id });
  return rows.map((r) => r.id);
}

/** A user's notifications, newest first. */
export async function listNotifications(
  db: Database,
  userId: UserId,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRow[]> {
  const where = options.unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId);
  return db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
}

export async function countUnread(db: Database, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

/**
 * Mark notifications read. Only the owner's rows are touched, so passing
 * another user's ids does nothing. Returns how many were updated.
 */
export async function markNotificationsRead(
  db: Database,
  userId: UserId,
  ids: readonly NotificationId[] | 'all',
): Promise<number> {
  const scope =
    ids === 'all'
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : ids.length === 0
        ? undefined
        : and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            inArray(notifications.id, [...ids]),
          );
  if (!scope) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(scope)
    .returning({ id: notifications.id });
  return rows.length;
}
