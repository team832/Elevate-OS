'use server';

import { z } from 'zod';
import {
  addObservation,
  createOptimisationItem,
  observationBody,
  optimisationCreateBody,
  optimisationReviewBody,
  optimisationUpdateBody,
  reviewOptimisationItem,
  submitOptimisationItem,
  updateOptimisationItem,
} from '../../server/optimisation';
import { go, run, str, strs } from '../actions/common';

const issues = (e: z.ZodError) =>
  e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
const TEXT_FIELDS = [
  'pageUrl',
  'topic',
  'targetQuery',
  'categoryKey',
  'baselineObservation',
  'requiredChange',
  'dueOn',
  'measurementSource',
  'observationOn',
] as const;
const fields = (form: FormData, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, str(form, k)]));

function itemId(form: FormData): string {
  const id = str(form, 'id') ?? '';
  if (!z.uuid().safeParse(id).success) go('optimisation', { error: 'Item not found.' });
  return id;
}

export async function createOptimisationAction(form: FormData): Promise<void> {
  const parsed = optimisationCreateBody.safeParse({
    ...fields(form, TEXT_FIELDS),
    ownerStaffId: str(form, 'ownerStaffId'),
    checks: strs(form, 'checks'),
  });
  if (!parsed.success) go('optimisation', { error: issues(parsed.error) });
  const res = await run((db, user) => createOptimisationItem(db, user, parsed.data));
  if (!res.ok) go('optimisation', { error: res.error });
  go(`optimisation/${res.value.id}`, { notice: 'Work item added.' });
}

export async function updateOptimisationAction(form: FormData): Promise<void> {
  const id = itemId(form);
  const back = `optimisation/${id}`;
  const parsed = optimisationUpdateBody.safeParse({
    ...fields(form, [...TEXT_FIELDS, 'evidence']),
    checks: strs(form, 'checks'),
    done: strs(form, 'done'),
  });
  if (!parsed.success) go(back, { error: issues(parsed.error) });
  const res = await run((db, user) => updateOptimisationItem(db, user, id, parsed.data));
  go(back, res.ok ? { notice: 'Saved.' } : { error: res.error });
}

export async function submitOptimisationAction(form: FormData): Promise<void> {
  const id = itemId(form);
  const res = await run((db, user) => submitOptimisationItem(db, user, id));
  go(`optimisation/${id}`, res.ok ? { notice: 'Submitted for review.' } : { error: res.error });
}

export async function reviewOptimisationAction(form: FormData): Promise<void> {
  const id = itemId(form);
  const back = `optimisation/${id}`;
  const parsed = optimisationReviewBody.safeParse(fields(form, ['decision', 'note']));
  if (!parsed.success) go(back, { error: issues(parsed.error) });
  const res = await run((db, user) => reviewOptimisationItem(db, user, id, parsed.data));
  go(back, res.ok ? { notice: 'Review saved.' } : { error: res.error });
}

export async function addObservationAction(form: FormData): Promise<void> {
  const id = itemId(form);
  const back = `optimisation/${id}`;
  const parsed = observationBody.safeParse(
    fields(form, ['platform', 'query', 'observedOn', 'result', 'note']),
  );
  if (!parsed.success) go(back, { error: issues(parsed.error) });
  const res = await run((db, user) => addObservation(db, user, id, parsed.data));
  go(back, res.ok ? { notice: 'Observation logged.' } : { error: res.error });
}
