/**
 * Task reminder job and due-work panel (owner brief 23 Oct 2026 §8). Windows and the personal
 * preference rule: domain/task-notices.ts. Each reminder claims its window in ops.task_reminders
 * (unique; ON CONFLICT DO NOTHING) before notifying, so running the job twice sends nothing
 * twice. In-app only: nothing leaves Elevate OS.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lte, min, or, sql } from 'drizzle-orm';
import {
  notifications,
  opsStaffTasks as tasks,
  opsTaskReminders,
  staffMembers,
  type Database,
} from '@elevate/database';
import { loadNotificationPreferences, notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import type { UserId } from '@elevate/shared-types';
import { istToday } from '../domain/dates';
import { deadlineText, WORK_STATUSES, type TaskStatus } from '../domain/staff-tasks';
import { dueState, remindersDue, type ReminderKind } from '../domain/task-notices';
import { accessScope, staffIdForUser, type Actor } from './context';
import { loadSettings } from './settings';
import { isGroup } from './task-list';
import { linkFor } from './task-links';

const TITLE: Record<ReminderKind, string> = {
  due_soon: 'Due soon',
  overdue: 'Overdue',
  unacknowledged: 'Please acknowledge',
};
const open = () => and(inArray(tasks.status, WORK_STATUSES as TaskStatus[]), sql`not ${isGroup}`);
/** Last IST day a deadline can fall on and still be within `hours` of `now`. */
const horizon = (now: Date, hours: number) => istToday(new Date(+now + hours * 3_600_000));

export async function runTaskReminders(
  db: Database,
  options: { now?: Date; actor?: Actor; requestId?: string } = {},
) {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  const now = options.now ?? new Date();
  const s = (await loadSettings(db))['tasks.reminders'].value;
  return withTransaction(db, async (tx) => {
    const rows = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        dueOn: tasks.dueOn,
        dueTime: tasks.dueTime,
        deliveredAt: tasks.deliveredAt,
        acknowledgedAt: tasks.acknowledgedAt,
        staffId: tasks.staffId,
        userId: staffMembers.userId,
      })
      .from(tasks)
      .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
      .where(
        and(
          open(),
          isNotNull(staffMembers.userId),
          or(
            lte(tasks.dueOn, horizon(now, s.dueSoonHours)),
            and(isNull(tasks.acknowledgedAt), isNotNull(tasks.deliveredAt)),
          ),
        ),
      );
    const prefs = await loadNotificationPreferences(
      tx,
      rows.map((r) => r.userId as UserId),
    );
    const sent: Record<ReminderKind, number> = { due_soon: 0, overdue: 0, unacknowledged: 0 };
    for (const r of rows) {
      const userId = r.userId as UserId;
      for (const rem of remindersDue(r, now, s, prefs.get(userId)!.reminderIntervalHours)) {
        const [claimed] = await tx
          .insert(opsTaskReminders)
          .values({ taskId: r.id, staffId: r.staffId, ...rem, sentAt: now })
          .onConflictDoNothing()
          .returning({ id: opsTaskReminders.id });
        if (!claimed) continue;
        await notify(tx, {
          userIds: [userId],
          module: 'ops',
          kind: `task.${rem.kind}`,
          title: `${TITLE[rem.kind]}: ${r.title}`,
          body: `Due ${deadlineText(r.dueOn, r.dueTime)}.`,
          link: await linkFor(tx, userId, 'work', `/tasks/${r.id}`),
          entityType: 'staff_task',
          entityId: r.id,
        });
        sent[rem.kind] += 1;
      }
    }
    await recordAudit(tx, {
      actorType: options.actor ? 'user' : 'system',
      actorUserId: options.actor?.id ?? null,
      module: 'ops',
      action: 'job.task_reminders',
      entityType: 'job',
      entityId: 'task-reminders',
      after: { sent, considered: rows.length, settings: s },
      requestId: options.requestId,
    });
    return { sent, considered: rows.length };
  });
}

/** The caller's open work that is overdue or due within the due-soon hours; null = no staff record. */
export async function dueWork(db: Database, actor: Actor, now = new Date()) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const { dueSoonHours } = (await loadSettings(db))['tasks.reminders'].value;
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, dueTime: tasks.dueTime })
    .from(tasks)
    .where(and(eq(tasks.staffId, staffId), open(), lte(tasks.dueOn, horizon(now, dueSoonHours))))
    .orderBy(asc(tasks.dueOn), asc(tasks.dueTime))
    .limit(50);
  const items = rows.flatMap((r) => {
    const state = dueState(r, now, dueSoonHours);
    return state ? [{ ...r, state }] : [];
  });
  return { dueSoonHours, items };
}

/** When the owner first read the task's assignment notification (the "Read" state); null = not yet. */
export async function assignmentReadAt(db: Database, taskId: string, ownerUserId: string | null) {
  if (!ownerUserId) return null;
  const [r] = await db
    .select({ at: min(notifications.readAt) })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ownerUserId as UserId),
        eq(notifications.kind, 'task.assigned'),
        eq(notifications.entityType, 'staff_task'),
        eq(notifications.entityId, taskId),
      ),
    );
  return r?.at ?? null;
}
