/**
 * Personal Settings (brief 23 Oct 2026 §13) in core.user_preferences: the signed-in user's OWN
 * row only (core write rule: "only the user it belongs to, through module services"). The id
 * always comes from the session, never from input. These settings change what the person sees
 * by default; they never change HR deadlines, assignments, permissions or reporting duties.
 * Stored under two keys so other workspaces keep theirs: `marketing` and `notifications`
 * (notifications are shared with the reminder job, which must never let them override HR).
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { userPreferences, type Database } from '@elevate/database';
import { readNotificationPreferences } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import { dashboardDefaultsSchema } from './dashboard-filters';

export const CALENDAR_VIEWS = ['month', 'week', 'list'] as const;
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Hours between reminders about your own open tasks; null = HR's schedule only. */
export const REMINDER_INTERVALS = [2, 4, 8, 24] as const;
export const FOCUS_MAX = 5;
export const CHECKLIST_MAX = 15;
export const GOALS_MAX = 5;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 09:30.');
const ordered = { error: 'The end time must be after the start time.' };
const endsAfterStart = (v: { start: string; end: string }) => v.start < v.end;
const hours = { start: time, end: time };

export const marketingPreferencesSchema = z
  .object({
    dashboard: dashboardDefaultsSchema.default(dashboardDefaultsSchema.parse({})),
    calendarView: z.enum(CALENDAR_VIEWS).default('month'),
    workingHours: z
      .object({ ...hours, days: z.array(z.enum(WEEKDAYS)).min(1).max(7) })
      .strict()
      .refine(endsAfterStart, ordered)
      .nullable()
      .default(null),
    focusBlocks: z
      .array(
        z
          .object({ ...hours, day: z.enum(WEEKDAYS), label: z.string().trim().max(80) })
          .strict()
          .refine(endsAfterStart, ordered),
      )
      .max(FOCUS_MAX)
      .default([]),
    checklist: z
      .array(z.object({ label: z.string().trim().min(1).max(120), done: z.boolean() }).strict())
      .max(CHECKLIST_MAX)
      .default([]),
    goals: z.array(z.string().trim().min(1).max(200)).max(GOALS_MAX).default([]),
  })
  .strict();

export const notificationPreferencesSchema = z
  .object({
    reminderIntervalHours: z.literal(REMINDER_INTERVALS).nullable().default(null),
    popUps: z.boolean().default(true),
  })
  .strict();

export const preferencesBody = z
  .object({ marketing: marketingPreferencesSchema, notifications: notificationPreferencesSchema })
  .strict();
export type Preferences = z.output<typeof preferencesBody>;

/** A stored part that no longer matches the schema reads as the defaults (never a crash). */
const parseOr = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
  const r = schema.safeParse(value ?? {});
  return r.success ? r.data : schema.parse({});
};

export async function getMyPreferences(db: Database, actor: Actor) {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, actor.id))
    .limit(1);
  const s = row?.settings ?? {};
  return {
    marketing: parseOr(marketingPreferencesSchema, s.marketing),
    notifications: readNotificationPreferences(s),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Upsert the caller's own row; other top-level keys (other workspaces) are kept. */
export async function saveMyPreferences(
  db: Database,
  actor: Actor,
  input: Preferences,
  requestId?: string,
) {
  assertCan(actor, 'marketing:module:access');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(userPreferences)
      .values({ userId: actor.id, settings: input })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          settings: sql`${userPreferences.settings} || ${JSON.stringify(input)}::jsonb`,
          updatedAt: new Date(),
        },
      })
      .returning();
    await auditMarketing(tx, actor, {
      action: 'user_preferences.updated',
      entityType: 'user_preferences',
      entityId: actor.id,
      after: input,
      requestId,
    });
    return row!;
  });
}
