/**
 * Marketing calendar items (brief 23 Oct 2026 §12). Every reader of the calendar sees every item;
 * writing is `marketing:calendar:write` (own = items you own or created). Approval needs
 * content:approve and never on your own item; scheduling and moving the date need
 * schedule:manage; a manual publication needs content:publish and a URL or evidence. Nothing is
 * posted anywhere by these actions.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { scopeFor, type Permission } from '@elevate/authorization';
import { isForeignKeyViolation, marketingCalendarItems, type Database } from '@elevate/database';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import {
  CALENDAR_ACTION_TEXT,
  CALENDAR_ITEM_TYPES,
  CALENDAR_STATUS_LABELS,
  CHANNELS,
  calendarEditable,
  calendarMovable,
  nextCalendarStatus,
  type CalendarAction,
} from '../domain/calendar';
import { assertCan, type Actor } from './access';
import { memberOptions } from './campaign-members';
import { auditMarketing, rowById } from './common';
import { myStaffId } from './scope';

export * from './calendar-queries';

export type CalendarItemRow = typeof marketingCalendarItems.$inferSelect;
type ItemInsert = typeof marketingCalendarItems.$inferInsert;

const optText = (max: number) => z.string().trim().max(max).nullish();
const optUuid = z.uuid().nullish();
/** A form's `YYYY-MM-DDTHH:MM` is IST; a full ISO instant keeps its offset. */
export const istDateTime = z.union([
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
    .transform((v) => new Date(`${v.slice(0, 16)}:00+05:30`)),
  z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
]);

const calendarFields = {
  title: z.string().trim().min(3).max(300),
  itemType: z.enum(CALENDAR_ITEM_TYPES),
  programmeId: optUuid,
  audience: optText(500),
  channel: z.enum(CHANNELS).nullish(),
  campaignId: optUuid,
  ownerStaffId: optUuid,
  brief: optText(5000),
  assetLinks: z
    .array(z.url({ protocol: /^https?$/ }).max(2000))
    .max(20)
    .optional(),
};

export const createCalendarItemBody = z
  .object({ ...calendarFields, plannedAt: istDateTime.optional() })
  .strict();
export const updateCalendarItemBody = z
  .object(calendarFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Send at least one field to change.' });
/** One body for every workflow action; each action checks what it needs. */
export const calendarActionBody = z
  .object({
    plannedAt: istDateTime.optional(),
    note: z.string().trim().max(1000).optional(),
    reason: z.string().trim().max(500).optional(),
    publishedAt: istDateTime.optional(),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional(),
    evidence: z.string().trim().max(2000).optional(),
  })
  .strict();
export const moveCalendarItemBody = z.object({ plannedAt: istDateTime }).strict();
export type CreateCalendarItemInput = z.output<typeof createCalendarItemBody>;
export type CalendarActionInput = z.output<typeof calendarActionBody>;

/** Who may take each step (own scope of calendar:write is checked on the item as well). */
export const CALENDAR_ACTION_PERMISSION: Record<CalendarAction, Permission> = {
  plan: 'marketing:calendar:write',
  start: 'marketing:calendar:write',
  submit: 'marketing:calendar:write',
  cancel: 'marketing:calendar:write',
  approve: 'marketing:content:approve',
  request_changes: 'marketing:content:approve',
  schedule: 'marketing:schedule:manage',
  publish: 'marketing:content:publish',
};

const lockItem = (db: Database, id: string) =>
  rowById(db, marketingCalendarItems, id, 'Calendar item not found.', true);

type Owned = { createdBy: string | null; ownerStaffId: string | null };

/** The current owner's item; the creator's only while nobody owns it (I3). */
export async function isOwnCalendarItem(db: Database, actor: Actor, item: Owned) {
  if (!item.ownerStaffId) return item.createdBy === actor.id;
  return item.ownerStaffId === (await myStaffId(db, actor.id));
}

/** Creator or owner: such a person never reviews the item. */
export const isCreatorOrOwner = async (db: Database, actor: Actor, item: Owned) =>
  item.createdBy === actor.id || (await isOwnCalendarItem(db, actor, item));

/** Own scope may change only items it owns or created (403: everyone may read every item). */
export async function assertCalendarWritable(db: Database, actor: Actor, item: Owned) {
  assertCan(actor, 'marketing:calendar:write');
  if (
    scopeFor(actor, 'marketing:calendar:write') === 'own' &&
    !(await isOwnCalendarItem(db, actor, item))
  )
    throw new ForbiddenError('You can change only calendar items you own or created.');
}

/** The owner must be active Marketing & Growth staff; own scope may name only themselves, never nobody. */
async function checkOwner(db: Database, actor: Actor, ownerStaffId: string | null) {
  if (
    scopeFor(actor, 'marketing:calendar:write') === 'own' &&
    (!ownerStaffId || ownerStaffId !== (await myStaffId(db, actor.id)))
  )
    throw new ForbiddenError(
      ownerStaffId
        ? 'Only a marketing manager can give an item to someone else.'
        : 'An item needs an owner: link your account to a staff record, or ask a marketing manager.',
    );
  if (ownerStaffId && !(await memberOptions(db, ownerStaffId)).length)
    throw new ValidationError('The owner must be active Marketing & Growth staff.');
}

/** Foreign keys (course, campaign) that vanished become a 400, not a 500. */
async function writing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isForeignKeyViolation(error))
      throw new ValidationError('The course or campaign chosen no longer exists.');
    throw error;
  }
}

export async function createCalendarItem(
  db: Database,
  actor: Actor,
  input: CreateCalendarItemInput,
  requestId?: string,
): Promise<CalendarItemRow> {
  assertCan(actor, 'marketing:calendar:write');
  return withTransaction(db, async (tx) => {
    const own = scopeFor(actor, 'marketing:calendar:write') === 'own';
    const ownerStaffId = (input.ownerStaffId ??
      (own ? await myStaffId(tx, actor.id) : null)) as ItemInsert['ownerStaffId'];
    await checkOwner(tx, actor, ownerStaffId ?? null);
    const { plannedAt, ...fields } = input;
    const [item] = await writing(() =>
      tx
        .insert(marketingCalendarItems)
        .values({
          ...(fields as ItemInsert),
          ownerStaffId,
          status: plannedAt ? 'planned' : 'idea',
          plannedAt: plannedAt ?? null,
          originalPlannedAt: plannedAt ?? null,
          createdBy: actor.id,
        })
        .returning(),
    );
    await auditMarketing(tx, actor, {
      action: 'calendar_item.created',
      entityType: 'calendar_item',
      entityId: item!.id,
      after: item,
      requestId,
    });
    return item!;
  });
}

export async function updateCalendarItem(
  db: Database,
  actor: Actor,
  id: string,
  patch: z.output<typeof updateCalendarItemBody>,
  requestId?: string,
): Promise<CalendarItemRow> {
  return withTransaction(db, async (tx) => {
    const before = await lockItem(tx, id);
    await assertCalendarWritable(tx, actor, before);
    if (!calendarEditable(before.status))
      throw new InvalidStateTransitionError(
        `A ${CALENDAR_STATUS_LABELS[before.status].toLowerCase()} item cannot be edited. Ask the reviewer to request changes first.`,
      );
    if (patch.ownerStaffId !== undefined && patch.ownerStaffId !== before.ownerStaffId)
      await checkOwner(tx, actor, patch.ownerStaffId ?? null);
    const [after] = await writing(() =>
      tx
        .update(marketingCalendarItems)
        .set(patch as Partial<ItemInsert>)
        .where(eq(marketingCalendarItems.id, before.id))
        .returning(),
    );
    await auditMarketing(tx, actor, {
      action: 'calendar_item.updated',
      entityType: 'calendar_item',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after!;
  });
}

/** One workflow step (plan … cancel). Moving the date is `moveCalendarItem`. */
export async function actOnCalendarItem(
  db: Database,
  actor: Actor,
  id: string,
  action: CalendarAction,
  input: CalendarActionInput = {},
  requestId?: string,
  now: Date = new Date(),
): Promise<CalendarItemRow> {
  assertCan(actor, CALENDAR_ACTION_PERMISSION[action]);
  return withTransaction(db, async (tx) => {
    const before = await lockItem(tx, id);
    if (CALENDAR_ACTION_PERMISSION[action] === 'marketing:calendar:write')
      await assertCalendarWritable(tx, actor, before);
    const to = nextCalendarStatus(before.status, action);
    if (!to)
      throw new InvalidStateTransitionError(
        `“${CALENDAR_ACTION_TEXT[action].button}” is not possible while the item is ${CALENDAR_STATUS_LABELS[before.status].toLowerCase()}.`,
      );
    const set: Partial<ItemInsert> = { status: to };
    if (action === 'plan') {
      const at = before.plannedAt ?? input.plannedAt;
      if (!at) throw new ValidationError('Give the planned date and time.');
      set.plannedAt = at;
      set.originalPlannedAt = before.originalPlannedAt ?? at;
    }
    if (action === 'approve' || action === 'request_changes') {
      if (await isCreatorOrOwner(tx, actor, before))
        throw new ForbiddenError('Another approver must review an item you own or created.');
      if (action === 'approve') Object.assign(set, { approvedBy: actor.id, approvedAt: now });
      else if (!input.note || input.note.length < 3)
        throw new ValidationError('Say what needs to change.');
      set.reviewNote = input.note ?? null;
    }
    if (action === 'publish') {
      if (!input.url && !input.evidence)
        throw new ValidationError('Give the live link or describe the evidence of publication.');
      const at = input.publishedAt ?? now;
      if (at.getTime() > now.getTime() + 5 * 60_000)
        throw new ValidationError('The publication time cannot be in the future.');
      Object.assign(set, {
        publishedAt: at,
        publishedUrl: input.url ?? null,
        publicationEvidence: input.evidence ?? null,
        publishedBy: actor.id,
      });
    }
    if (action === 'cancel') {
      if (!input.reason || input.reason.length < 3)
        throw new ValidationError('Give a reason for cancelling.');
      set.cancelledReason = input.reason;
    }
    const [after] = await tx
      .update(marketingCalendarItems)
      .set(set)
      .where(eq(marketingCalendarItems.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: `calendar_item.${CALENDAR_ACTION_TEXT[action].event}`,
      entityType: 'calendar_item',
      entityId: before.id,
      before: { status: before.status },
      after: { ...set },
      requestId,
    });
    return after!;
  });
}

/** Drag or "Move to…": a new planned time; original_planned_at never changes once set. */
export async function moveCalendarItem(
  db: Database,
  actor: Actor,
  id: string,
  plannedAt: Date,
  requestId?: string,
): Promise<CalendarItemRow> {
  assertCan(actor, 'marketing:schedule:manage');
  return withTransaction(db, async (tx) => {
    const before = await lockItem(tx, id);
    if (before.plannedAt?.getTime() === plannedAt.getTime()) return before;
    if (!calendarMovable(before.status))
      throw new InvalidStateTransitionError(
        `A ${CALENDAR_STATUS_LABELS[before.status].toLowerCase()} item cannot be moved.`,
      );
    const [after] = await tx
      .update(marketingCalendarItems)
      .set({ plannedAt, originalPlannedAt: before.originalPlannedAt ?? plannedAt })
      .where(eq(marketingCalendarItems.id, before.id))
      .returning();
    await auditMarketing(tx, actor, {
      action: 'calendar_item.rescheduled',
      entityType: 'calendar_item',
      entityId: before.id,
      before: { plannedAt: before.plannedAt },
      after: { plannedAt },
      requestId,
    });
    return after!;
  });
}
