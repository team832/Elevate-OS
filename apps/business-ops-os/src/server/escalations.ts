/**
 * Task escalation job and handling (OPS-017). Rules are pure (domain/escalation.ts):
 * thresholds come from the `tasks.escalation` setting (proposed), recipients from
 * the staff reporting lines. Every raise, acknowledgement and resolution is audited.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  opsEscalations,
  opsTaskReminders,
  opsTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  evaluateEscalation,
  resolveEscalationRecipient,
  taskRemindersDue,
  type EscalationLevel,
  type IsoDate,
  type TaskReminderKind,
  type TaskStatus,
} from '../domain';
import {
  accessScope,
  notFound,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type Actor,
} from './context';
import { loadSettings } from './settings';

export interface EscalationRunResult {
  evaluated: number;
  raised: { taskCode: string; level: number; recipientStaffId: string | null; via: string }[];
}

/** Evaluate every open task and raise missing escalation levels. Idempotent (unique task+level). */
export async function runTaskEscalations(
  db: Database,
  options: { now?: Date; actor?: Actor; requestId?: string } = {},
): Promise<EscalationRunResult> {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  const now = options.now ?? new Date();
  const thresholds = (await loadSettings(db))['tasks.escalation'].value;
  return withTransaction(db, async (tx) => {
    const tasks = await tx
      .select()
      .from(opsTasks)
      .where(
        inArray(opsTasks.status, ['not_started', 'in_progress', 'waiting', 'at_risk', 'blocked']),
      )
      .for('update');
    const staff = await tx
      .select({ id: staffMembers.id, managerId: staffMembers.managerId })
      .from(staffMembers);
    const managerOf = new Map(staff.map((s) => [s.id as string, s.managerId as string | null]));
    const existing = tasks.length
      ? await tx
          .select({ taskId: opsEscalations.taskId, level: opsEscalations.level })
          .from(opsEscalations)
          .where(
            inArray(
              opsEscalations.taskId,
              tasks.map((t) => t.id),
            ),
          )
      : [];
    const opsManagers = await userIdsWithRole(tx, 'operations_manager');
    const result: EscalationRunResult = { evaluated: tasks.length, raised: [] };
    for (const task of tasks) {
      const proposals = evaluateEscalation(
        {
          status: task.status as TaskStatus,
          dueDate: task.dueDate as IsoDate | null,
          blockedSince: task.blockedSince,
          ownerStaffId: task.ownerStaffId,
          raisedLevels: existing.filter((e) => e.taskId === task.id).map((e) => e.level),
        },
        now,
        thresholds,
      );
      for (const p of proposals) {
        const recipient = resolveEscalationRecipient(task.ownerStaffId, p.level, (id) =>
          managerOf.get(id),
        );
        const [row] = await tx
          .insert(opsEscalations)
          .values({
            taskId: task.id,
            level: p.level,
            trigger: p.trigger,
            reason: recipient.recipientStaffId
              ? p.reason
              : `${p.reason} No recipient on the reporting line (${recipient.via}); routed to operations managers.`,
            daysOverdue: p.daysOverdue,
            thresholdDays: p.thresholdDays,
            recipientStaffId: recipient.recipientStaffId as StaffMemberId | null,
            respondBy: p.respondBy,
            raisedBy: options.actor?.id ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) continue;
        if (p.level > task.escalationLevel)
          await tx
            .update(opsTasks)
            .set({ escalationLevel: p.level })
            .where(eq(opsTasks.id, task.id));
        await recordAudit(tx, {
          actorType: options.actor ? 'user' : 'system',
          actorUserId: options.actor?.id ?? null,
          module: 'ops',
          action: 'task.escalated',
          entityType: 'task',
          entityId: task.id,
          after: row,
          requestId: options.requestId,
          metadata: { level: p.level, via: recipient.via },
        });
        const recipients = recipient.recipientStaffId
          ? await userIdsForStaff(tx, [recipient.recipientStaffId])
          : opsManagers;
        const ownerUsers = await userIdsForStaff(tx, [task.ownerStaffId]);
        await notify(tx, {
          userIds: [...new Set([...(recipients.length ? recipients : opsManagers), ...ownerUsers])],
          module: 'ops',
          kind: 'task.escalated',
          title: `L${p.level} escalation: ${task.title} (${task.code})`,
          body: `${p.reason} Respond by ${p.respondBy}. The owner keeps the task.`,
          link: `/ops/tasks/${task.id}`,
          entityType: 'task',
          entityId: task.id,
        });
        result.raised.push({
          taskCode: task.code,
          level: p.level as EscalationLevel,
          recipientStaffId: recipient.recipientStaffId,
          via: recipient.via,
        });
      }
    }
    return result;
  });
}

/** The recipient (or any holder of all-scope ops:tasks:write) acknowledges or resolves. */
export async function handleEscalation(
  db: Database,
  actor: Actor,
  id: string,
  input: { action: 'acknowledge' | 'resolve'; note?: string | null },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:tasks:write');
  const me = await staffIdForUser(db, actor.id);
  return withTransaction(db, async (tx) => {
    const [esc] = await tx
      .select()
      .from(opsEscalations)
      .where(eq(opsEscalations.id, id as typeof opsEscalations.$inferSelect.id))
      .for('update');
    if (!esc) notFound('Escalation');
    if (access.scope !== 'all' && (!me || esc.recipientStaffId !== me))
      throw new ForbiddenError(
        'Only the escalation recipient or an operations manager can do this.',
      );
    if (esc.status === 'resolved') throw new ConflictError('This escalation is already resolved.');
    if (input.action === 'acknowledge' && esc.status !== 'open')
      throw new ConflictError('This escalation is already acknowledged.');
    if (input.action === 'resolve' && !input.note?.trim())
      throw new ValidationError('Describe how it was resolved.', {
        details: [{ location: 'body', path: ['note'], message: 'Required' }],
      });
    const now = new Date();
    const [after] = await tx
      .update(opsEscalations)
      .set(
        input.action === 'acknowledge'
          ? { status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: actor.id }
          : {
              status: 'resolved',
              resolvedAt: now,
              resolvedBy: actor.id,
              resolutionNote: input.note?.trim() ?? null,
              ...(esc.acknowledgedAt ? {} : { acknowledgedAt: now, acknowledgedBy: actor.id }),
            },
      )
      .where(and(eq(opsEscalations.id, esc.id)))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `escalation.${input.action === 'acknowledge' ? 'acknowledged' : 'resolved'}`,
      entityType: 'task',
      entityId: esc.taskId,
      before: esc,
      after,
      requestId,
    });
    return after;
  });
}

// --- reminders (OPS-063) -------------------------------------------------------------------------

export interface TaskReminderRunResult {
  evaluated: number;
  sent: { taskCode: string; kind: TaskReminderKind; recipients: number }[];
}

/**
 * Due-soon and overdue reminders (setting `tasks.reminders`, proposed). Each
 * kind is sent once per task and due date (unique index), so the job is
 * idempotent. Recipients: the owner; without an owner the accountable owner,
 * else operations managers; overdue reminders also go to the backup when the
 * setting says so. Tasks without a due date are never reminded.
 */
export async function runTaskReminders(
  db: Database,
  options: { now?: Date; actor?: Actor; requestId?: string } = {},
): Promise<TaskReminderRunResult> {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  const now = options.now ?? new Date();
  const settings = (await loadSettings(db))['tasks.reminders'].value;
  return withTransaction(db, async (tx) => {
    const tasks = await tx
      .select()
      .from(opsTasks)
      .where(
        and(
          inArray(opsTasks.status, ['not_started', 'in_progress', 'waiting', 'at_risk', 'blocked']),
          isNotNull(opsTasks.dueDate),
        ),
      );
    const sent = tasks.length
      ? await tx
          .select({
            taskId: opsTaskReminders.taskId,
            kind: opsTaskReminders.kind,
            dueDate: opsTaskReminders.dueDate,
          })
          .from(opsTaskReminders)
          .where(
            inArray(
              opsTaskReminders.taskId,
              tasks.map((t) => t.id),
            ),
          )
      : [];
    const staff = await tx
      .select({ id: staffMembers.id, userId: staffMembers.userId })
      .from(staffMembers);
    const userOf = (sid: string | null) => staff.find((s) => s.id === sid)?.userId ?? null;
    const opsManagers = await userIdsWithRole(tx, 'operations_manager');
    const result: TaskReminderRunResult = { evaluated: tasks.length, sent: [] };
    for (const task of tasks) {
      const kinds = taskRemindersDue(
        { status: task.status as TaskStatus, dueDate: task.dueDate as IsoDate | null },
        now,
        settings,
        sent.filter((s) => s.taskId === task.id),
      );
      for (const kind of kinds) {
        const primary = userOf(task.ownerStaffId) ?? userOf(task.accountableStaffId);
        const recipients = new Set(primary ? [primary] : opsManagers);
        const backup = userOf(task.backupStaffId);
        if (kind === 'overdue' && settings.notifyBackupWhenOverdue && backup)
          recipients.add(backup);
        const [row] = await tx
          .insert(opsTaskReminders)
          .values({
            taskId: task.id,
            kind,
            dueDate: task.dueDate as string,
            recipientCount: recipients.size,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) continue;
        if (recipients.size)
          await notify(tx, {
            userIds: [...recipients],
            module: 'ops',
            kind: kind === 'overdue' ? 'task.overdue' : 'task.due_soon',
            title:
              kind === 'overdue'
                ? `Overdue: ${task.title} (${task.code}), due ${task.dueDate}`
                : `Due ${task.dueDate}: ${task.title} (${task.code})`,
            body: task.ownerStaffId
              ? undefined
              : 'This task has no owner; assign one so it can be completed.',
            link: `/ops/tasks/${task.id}`,
            entityType: 'task',
            entityId: task.id,
          });
        await recordAudit(tx, {
          actorType: options.actor ? 'user' : 'system',
          actorUserId: options.actor?.id ?? null,
          module: 'ops',
          action: 'task.reminder_sent',
          entityType: 'task',
          entityId: task.id,
          after: { kind, dueDate: task.dueDate, recipients: recipients.size },
          requestId: options.requestId,
        });
        result.sent.push({ taskCode: task.code, kind, recipients: recipients.size });
      }
    }
    return result;
  });
}
