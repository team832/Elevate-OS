'use server';

import { redirect } from 'next/navigation';
import { toAppPath } from '@elevate/server-kit/next';
import {
  CALENDAR_ACTION_TEXT,
  isCalendarAction,
  issuesText as issues,
} from '../../domain/calendar';
import { MODULE, modulePath } from '../../domain';
import {
  actOnCalendarItem,
  calendarActionBody,
  createCalendarItem,
  createCalendarItemBody,
  moveCalendarItemBody,
  moveCalendarItem,
  updateCalendarItem,
  updateCalendarItemBody,
} from '../../server/calendar';
import { createCalendarTask } from '../../server/calendar-plan';
import { go, run, str } from '../actions/common';

/** The §12 fields as the item form posts them (empty = cleared). */
const formFields = (form: FormData) => ({
  title: str(form, 'title'),
  itemType: str(form, 'itemType'),
  programmeId: str(form, 'programmeId') ?? null,
  audience: str(form, 'audience') ?? null,
  channel: str(form, 'channel') ?? null,
  campaignId: str(form, 'campaignId') ?? null,
  ownerStaffId: str(form, 'ownerStaffId') ?? null,
  brief: str(form, 'brief') ?? null,
  assetLinks: (str(form, 'assetLinks') ?? '').split(/\s+/).filter(Boolean),
});

export async function createItemAction(form: FormData): Promise<void> {
  const parsed = createCalendarItemBody.safeParse({
    ...formFields(form),
    plannedAt: str(form, 'plannedAt'),
  });
  if (!parsed.success) go('calendar/new', { error: issues(parsed.error) });
  const res = await run((db, user) => createCalendarItem(db, user, parsed.data));
  if (!res.ok) go('calendar/new', { error: res.error });
  go(`calendar/${res.value.id}`, { notice: 'Calendar item saved.' });
}

export async function updateItemAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const parsed = updateCalendarItemBody.safeParse(formFields(form));
  if (!parsed.success) go(`calendar/${id}`, { error: issues(parsed.error) });
  const res = await run((db, user) => updateCalendarItem(db, user, id, parsed.data));
  go(`calendar/${id}`, res.ok ? { notice: 'Changes saved.' } : { error: res.error });
}

/** One workflow button (plan, start, submit, approve, request changes, schedule, publish, cancel). */
export async function itemStepAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const action = str(form, 'step');
  if (!isCalendarAction(action)) go(`calendar/${id}`, { error: 'Unknown step.' });
  const parsed = calendarActionBody.safeParse(
    Object.fromEntries(
      ['plannedAt', 'note', 'reason', 'publishedAt', 'url', 'evidence'].flatMap((k) =>
        str(form, k) ? [[k, str(form, k)]] : [],
      ),
    ),
  );
  if (!parsed.success) go(`calendar/${id}`, { error: issues(parsed.error) });
  const res = await run((db, user) => actOnCalendarItem(db, user, id, action, parsed.data));
  go(
    `calendar/${id}`,
    res.ok ? { notice: `${CALENDAR_ACTION_TEXT[action].button}: done.` } : { error: res.error },
  );
}

/** "Move to…" and drag-and-drop; returns to the view the person came from. */
export async function moveItemAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const back = str(form, 'back');
  const parsed = moveCalendarItemBody.safeParse({ plannedAt: str(form, 'plannedAt') });
  const res = parsed.success
    ? await run((db, user) => moveCalendarItem(db, user, id, parsed.data.plannedAt))
    : ({ ok: false, error: 'Give the new date and time.' } as const);
  const qs = new URLSearchParams(back ?? '');
  qs.set(
    res.ok ? 'notice' : 'error',
    res.ok ? 'Moved. The original date stays on the item.' : res.error,
  );
  redirect(toAppPath(`${modulePath(back ? 'calendar' : `calendar/${id}`)}?${qs}`, MODULE.basePath));
}

/** The item's Ops task, created by the Ops task service. */
export async function createTaskAction(form: FormData): Promise<void> {
  const id = str(form, 'itemId') ?? '';
  const res = await run((db, user) => createCalendarTask(db, user, id));
  go(
    `calendar/${id}`,
    res.ok
      ? {
          notice: res.value.created ? 'Task created in My Tasks.' : 'This item already has a task.',
        }
      : { error: res.error },
  );
}
