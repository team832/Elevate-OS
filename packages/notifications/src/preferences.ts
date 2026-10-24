/**
 * A person's notification preferences (core.user_preferences `notifications`, written by each
 * workspace's Personal Settings). They may only REDUCE noise: `popUps: false` turns off the toast
 * (the notification is still stored and counted), `reminderIntervalHours` spaces out repeats the
 * reminder job allows it to. They never stop an overdue reminder or change a deadline.
 */
import { inArray } from 'drizzle-orm';
import { userPreferences, type Database } from '@elevate/database';
import type { UserId } from '@elevate/shared-types';

export interface NotificationPreferences {
  /** Hours between repeated reminders the person asked for; null = HR's schedule. */
  reminderIntervalHours: number | null;
  popUps: boolean;
}

/** Intervals Personal Settings offers (Marketing REMINDER_INTERVALS); anything else = HR's schedule. */
export const REMINDER_INTERVAL_HOURS = [2, 4, 8, 24] as const;

/** Anything unrecognised reads as the defaults (HR's schedule, pop-ups on). */
export function readNotificationPreferences(settings: unknown): NotificationPreferences {
  const n = (settings as { notifications?: Record<string, unknown> } | null)?.notifications;
  const hours = REMINDER_INTERVAL_HOURS.find((h) => h === n?.reminderIntervalHours);
  return { reminderIntervalHours: hours ?? null, popUps: n?.popUps !== false };
}

export async function loadNotificationPreferences(
  db: Database,
  userIds: readonly UserId[],
): Promise<Map<UserId, NotificationPreferences>> {
  const rows = userIds.length
    ? await db
        .select()
        .from(userPreferences)
        .where(inArray(userPreferences.userId, [...new Set(userIds)]))
    : [];
  const stored = new Map(rows.map((r) => [r.userId, r.settings]));
  return new Map(userIds.map((u) => [u, readNotificationPreferences(stored.get(u))]));
}
