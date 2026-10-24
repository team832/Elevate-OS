/**
 * An approved idea becomes ONE linked calendar item (brief §13): the item points back through
 * idea_id; the idea's history (status changes, content, placements) stays on the idea. A task for
 * the item is created by the one Ops task service (`@elevate/business-ops-os/work` createTask),
 * and its id is stored on the item in the same transaction.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { scopeFor } from '@elevate/authorization';
import { createTask, taskBody } from '@elevate/business-ops-os/work';
import { marketingCalendarItems, marketingIdeas, type Database } from '@elevate/database';
import { InvalidStateTransitionError, ValidationError, withTransaction } from '@elevate/server-kit';
import { CALENDAR_ITEM_TYPES, ITEM_TYPE_LABELS, issuesText } from '../domain/calendar';
import { istDate } from '../domain/week';
import { modulePath } from '../domain';
import { assertCan, type Actor } from './access';
import { assertCalendarWritable, istDateTime, type CalendarItemRow } from './calendar';
import { auditMarketing, rowById } from './common';
import { myStaffId } from './scope';

export const planIdeaBody = z
  .object({
    plannedAt: istDateTime.optional(),
    /** Needed when the idea has no proposed format. */
    itemType: z.enum(CALENDAR_ITEM_TYPES).optional(),
    /** Also create an Ops task for the item's owner. */
    createTask: z.boolean().default(false),
  })
  .strict();

/** Idempotent: a second call returns the item the first one created. */
export async function planIdea(
  db: Database,
  actor: Actor,
  ideaId: string,
  input: Omit<z.output<typeof planIdeaBody>, 'createTask'>,
  requestId?: string,
): Promise<{ item: CalendarItemRow; created: boolean }> {
  assertCan(actor, 'marketing:calendar:write');
  return withTransaction(db, async (tx) => {
    // The lock serialises two clicks on "Plan it"; the second finds the first one's item.
    const idea = await rowById(tx, marketingIdeas, ideaId, 'Idea not found.', true);
    const [existing] = await tx
      .select()
      .from(marketingCalendarItems)
      .where(eq(marketingCalendarItems.ideaId, idea.id))
      .limit(1);
    if (existing) return { item: existing, created: false };
    if (idea.status !== 'approved')
      throw new InvalidStateTransitionError('Only an approved idea can be put on the calendar.');
    await assertCalendarWritable(tx, actor, idea);
    const itemType = input.itemType ?? idea.proposedFormat;
    if (!itemType) throw new ValidationError('Choose the type of calendar item.');
    const own = scopeFor(actor, 'marketing:calendar:write') === 'own';
    const [item] = await tx
      .insert(marketingCalendarItems)
      .values({
        title: idea.title,
        itemType,
        status: input.plannedAt ? 'planned' : 'idea',
        programmeId: idea.programmeId,
        audience: idea.audience,
        channel: idea.proposedChannel,
        campaignId: idea.campaignId,
        ownerStaffId: idea.ownerStaffId ?? (own ? await myStaffId(tx, actor.id) : null),
        plannedAt: input.plannedAt ?? null,
        originalPlannedAt: input.plannedAt ?? null,
        brief: idea.brief,
        ideaId: idea.id,
        isSample: idea.isSample,
        createdBy: actor.id,
      })
      .returning();
    await auditMarketing(tx, actor, {
      action: 'calendar_item.created',
      entityType: 'calendar_item',
      entityId: item!.id,
      after: item,
      requestId,
      metadata: { fromIdea: idea.id },
    });
    return { item: item!, created: true };
  });
}

/** Creates the item's Ops task once, with the Ops task service, and stores the link in the same transaction. */
export async function createCalendarTask(
  db: Database,
  actor: Actor,
  itemId: string,
  requestId?: string,
): Promise<{ taskId: string; created: boolean }> {
  return withTransaction(db, async (tx) => {
    // The lock makes a second click wait and then find the first click's task.
    const item = await rowById(
      tx,
      marketingCalendarItems,
      itemId,
      'Calendar item not found.',
      true,
    );
    await assertCalendarWritable(tx, actor, item);
    if (item.relatedTaskId) return { taskId: item.relatedTaskId, created: false };
    if (item.status === 'cancelled' || item.status === 'published')
      throw new InvalidStateTransitionError('A cancelled or published item gets no new task.');
    const body = taskBody.safeParse({
      title: `${ITEM_TYPE_LABELS[item.itemType]}: ${item.title}`.slice(0, 200),
      details: `Marketing calendar item ${modulePath(`calendar/${item.id}`)}`,
      linkedRef: `Marketing calendar item ${item.id}`,
      ...(item.plannedAt ? { dueOn: istDate(item.plannedAt) } : {}),
      ...(item.ownerStaffId && item.ownerStaffId !== (await myStaffId(tx, actor.id))
        ? { staffId: item.ownerStaffId }
        : {}),
    });
    if (!body.success) throw new ValidationError(issuesText(body.error));
    const task = await createTask(tx, actor, body.data, requestId);
    await tx
      .update(marketingCalendarItems)
      .set({ relatedTaskId: task.id })
      .where(eq(marketingCalendarItems.id, item.id));
    await auditMarketing(tx, actor, {
      action: 'calendar_item.task_linked',
      entityType: 'calendar_item',
      entityId: item.id,
      before: { relatedTaskId: null },
      after: { relatedTaskId: task.id },
      requestId,
    });
    return { taskId: task.id, created: true };
  });
}
