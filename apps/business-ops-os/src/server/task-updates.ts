/**
 * Work updates on a task (brief 2 §6, A-TSK-7): append-only rows in `ops.task_updates`, separate
 * from comments and review decisions. A correction is a new row with a reason (once per entry).
 * Overlaps with the author's other entries that day are returned as warnings, never corrected.
 * Updates do not change the task row, so they do not bump its `version`.
 */
import { and, eq } from 'drizzle-orm';
import { opsTaskUpdates as updates, type Database, type OpsTaskUpdateId } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import { istToday } from '../domain/dates';
import { overlapWarnings } from '../domain/task-lifecycle';
import type { Actor } from './context';
import { fieldError } from './ops-common';
import { ownStaffId } from './staff-tasks';
import type { TaskUpdateInput } from './staff-tasks-schemas';
import { loadTaskFor, mayLogWork, taskAudit } from './task-store';

export async function addTaskUpdate(
  db: Database,
  actor: Actor,
  id: string,
  input: TaskUpdateInput,
  requestId?: string,
) {
  const author = await ownStaffId(db, actor);
  return withTransaction(db, async (tx) => {
    const loaded = await loadTaskFor(tx, actor, id, true);
    const { row } = loaded;
    if (!mayLogWork(loaded))
      throw new ForbiddenError(
        'Only the owner, the backup or their manager can log work on this task.',
      );
    const now = new Date();
    const occurredOn = input.occurredOn ?? istToday(input.startedAt ?? now);
    if (occurredOn > istToday(now))
      throw fieldError('occurredOn', 'The work date cannot be in the future.');
    if (input.correctsUpdateId) {
      const [old] = await tx
        .select()
        .from(updates)
        .where(eq(updates.id, input.correctsUpdateId as never));
      if (!old || old.taskId !== row.id || old.authorStaffId !== author)
        throw fieldError('correctsUpdateId', 'You can correct only your own entries on this task.');
    }
    const sameDay = await tx
      .select()
      .from(updates)
      .where(and(eq(updates.authorStaffId, author), eq(updates.occurredOn, occurredOn)));
    const [saved] = await tx
      .insert(updates)
      .values({
        ...input,
        correctsUpdateId: input.correctsUpdateId as OpsTaskUpdateId | null | undefined,
        taskId: row.id,
        authorUserId: actor.id,
        authorStaffId: author,
        occurredOn,
        occurredAt: input.startedAt ?? null,
        recordedAt: now,
        isSample: row.isSample,
      })
      .returning();
    const others = sameDay.filter((u) => u.id !== input.correctsUpdateId);
    await taskAudit(
      tx,
      actor,
      row.id,
      input.correctsUpdateId ? 'staff_task.update_corrected' : 'staff_task.update_added',
      { after: saved },
      requestId,
    );
    return { update: saved!, warnings: overlapWarnings(saved!, others) };
  });
}
