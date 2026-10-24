'use server';

import {
  changeIdeaStatus,
  createIdea,
  createIdeaBody,
  ideaStatusBody,
  updateIdea,
  updateIdeaBody,
} from '../../server';
import { createCalendarTask, planIdea, planIdeaBody } from '../../server/calendar-plan';
import { go, run, str, strs } from '../actions/common';
import { issuesText as issues } from '../../domain/calendar';

/** Fields the new and edit forms share (empty = cleared). */
const boardFields = (form: FormData) =>
  Object.fromEntries(
    [
      'title',
      'audience',
      'brief',
      'problemNeed',
      'hypothesis',
      'effort',
      'expectedOutcome',
      'proposedFormat',
      'proposedChannel',
      'programmeId',
      'ownerStaffId',
      'campaignId',
    ].map((k) => [k, str(form, k) ?? null]),
  );

export async function createIdeaAction(form: FormData): Promise<void> {
  const parsed = createIdeaBody.safeParse({
    ...boardFields(form),
    coursePrefix: str(form, 'coursePrefix'),
    title: str(form, 'title'),
    pillar: str(form, 'pillar') ?? null,
    series: str(form, 'series') ?? null,
    objective: str(form, 'objective') ?? null,
    source: str(form, 'source') ?? null,
    masterAsset: str(form, 'masterAsset') ?? null,
    scope: str(form, 'scope'),
    scopePrefixes: strs(form, 'scopePrefixes').length ? strs(form, 'scopePrefixes') : undefined,
  });
  if (!parsed.success) go('ideas/new', { error: issues(parsed.error) });
  const res = await run((db, user) => createIdea(db, user, parsed.data));
  if (!res.ok) go('ideas/new', { error: res.error });
  const warn = res.value.duplicates.candidates.length;
  go(`ideas/${res.value.idea.id}`, {
    notice: `Created ${res.value.idea.code}.${warn ? ` ${warn} possible duplicate(s) listed below — check them.` : ''}`,
  });
}

export async function updateIdeaAction(form: FormData): Promise<void> {
  const id = str(form, 'ideaId') ?? '';
  const parsed = updateIdeaBody.safeParse(boardFields(form));
  if (!parsed.success) go(`ideas/${id}`, { error: issues(parsed.error) });
  const res = await run((db, user) => updateIdea(db, user, id, parsed.data));
  go(`ideas/${id}`, res.ok ? { notice: 'Idea saved.' } : { error: res.error });
}

/** Submit for review, approve or request changes (the service enforces who may). */
export async function reviewIdeaAction(form: FormData): Promise<void> {
  const id = str(form, 'ideaId') ?? '';
  const parsed = ideaStatusBody.safeParse({
    status: str(form, 'status'),
    reason: str(form, 'reason'),
  });
  if (!parsed.success) go(`ideas/${id}`, { error: issues(parsed.error) });
  const res = await run((db, user) => changeIdeaStatus(db, user, id, parsed.data));
  go(`ideas/${id}`, res.ok ? { notice: 'Review state updated.' } : { error: res.error });
}

/** "Plan it": one linked calendar item, and the owner's task when asked for. */
export async function planIdeaAction(form: FormData): Promise<void> {
  const id = str(form, 'ideaId') ?? '';
  const parsed = planIdeaBody.safeParse({
    plannedAt: str(form, 'plannedAt'),
    itemType: str(form, 'itemType'),
    createTask: form.get('createTask') === 'on',
  });
  if (!parsed.success) go(`ideas/${id}`, { error: issues(parsed.error) });
  const { createTask, ...input } = parsed.data;
  const planned = await run((db, user) => planIdea(db, user, id, input));
  if (!planned.ok) go(`ideas/${id}`, { error: planned.error });
  const itemId = planned.value.item.id;
  if (createTask) {
    const task = await run((db, user) => createCalendarTask(db, user, itemId));
    if (!task.ok)
      go(`calendar/${itemId}`, {
        error: `The calendar item is saved, but the task was not created: ${task.error}`,
      });
  }
  go(`calendar/${itemId}`, {
    notice: planned.value.created
      ? 'Added to the calendar.'
      : 'This idea is already on the calendar.',
  });
}
