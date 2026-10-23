/**
 * Task checklists (owner brief 23 Oct 2026 §8): items are set when the task is created; the
 * owner (or whoever works on the task) ticks them. A tick is a `checklist_changed` event and an
 * audit row; it does not bump the task's version (it never conflicts with an edit).
 */
import { and, asc, eq } from 'drizzle-orm';
import { opsTaskChecklistItems as items, opsTaskEvents, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { Actor } from './context';
import { fieldError } from './ops-common';
import { loadTaskFor, taskAudit } from './task-store';

export async function addChecklist(tx: Database, taskId: string, lines: readonly string[]) {
  if (lines.length)
    await tx
      .insert(items)
      .values(lines.map((text, position) => ({ taskId: taskId as never, position, text })));
}

export const checklistOf = (db: Database, taskId: string) =>
  db
    .select()
    .from(items)
    .where(eq(items.taskId, taskId as never))
    .orderBy(asc(items.position));

/** Tick or untick one item (owner, manager, all scope; not a reviewer alone). */
export async function setChecklistItem(
  db: Database,
  actor: Actor,
  taskId: string,
  body: { itemId: string; done: boolean },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { row, roles } = await loadTaskFor(tx, actor, taskId, true);
    if (!roles.some((r) => r === 'owner' || r === 'manager' || r === 'admin'))
      throw new ForbiddenError(
        'Only the person doing the task or their manager ticks its checklist.',
      );
    const now = new Date();
    const [item] = await tx
      .update(items)
      .set(body.done ? { doneAt: now, doneBy: actor.id } : { doneAt: null, doneBy: null })
      .where(and(eq(items.id, body.itemId), eq(items.taskId, row.id)))
      .returning();
    if (!item) throw fieldError('itemId', 'That item is not on this task.');
    await tx.insert(opsTaskEvents).values({
      taskId: row.id,
      kind: 'checklist_changed',
      actorUserId: actor.id,
      occurredAt: now,
      data: { item: item.text, done: body.done },
    });
    await taskAudit(tx, actor, row.id, 'staff_task.checklist_changed', { after: item }, requestId);
    return item;
  });
}
