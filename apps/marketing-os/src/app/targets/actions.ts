'use server';

import { z } from 'zod';
import {
  createTarget,
  deleteTarget,
  targetBody,
  targetUpdateBody,
  updateTarget,
} from '../../server/targets';
import { go, run, str } from '../actions/common';

const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join('; ');
const num = (form: FormData, key: string) => {
  const v = str(form, key);
  return v === undefined ? undefined : Number(v);
};

async function targetId(form: FormData): Promise<string> {
  const id = str(form, 'id') ?? '';
  if (!z.uuid().safeParse(id).success) return go('targets', { error: 'Target not found.' });
  return id;
}

export async function createTargetAction(form: FormData): Promise<void> {
  const scope = str(form, 'scope');
  const parsed = targetBody.safeParse({
    scope,
    staffId: scope === 'employee' ? str(form, 'staffId') : undefined,
    campaignId: scope === 'campaign' ? str(form, 'campaignId') : undefined,
    metricKey: str(form, 'metricKey'),
    targetValue: num(form, 'targetValue'),
    periodStart: str(form, 'periodStart'),
    periodEnd: str(form, 'periodEnd'),
    note: str(form, 'note'),
  });
  if (!parsed.success) return go('targets', { error: issues(parsed.error) });
  const res = await run((db, user) => createTarget(db, user, parsed.data));
  if (!res.ok) return go('targets', { error: res.error });
  return go(`targets/${res.value.id}`, { notice: 'Target set.' });
}

export async function updateTargetAction(form: FormData): Promise<void> {
  const id = await targetId(form);
  const back = `targets/${id}`;
  const parsed = targetUpdateBody.safeParse({
    targetValue: num(form, 'targetValue'),
    periodStart: str(form, 'periodStart'),
    periodEnd: str(form, 'periodEnd'),
    note: str(form, 'note'),
  });
  if (!parsed.success) return go(back, { error: issues(parsed.error) });
  const res = await run((db, user) => updateTarget(db, user, id, parsed.data));
  return go(back, res.ok ? { notice: 'Target changed.' } : { error: res.error });
}

export async function deleteTargetAction(form: FormData): Promise<void> {
  const id = await targetId(form);
  const res = await run((db, user) => deleteTarget(db, user, id));
  if (!res.ok) return go(`targets/${id}`, { error: res.error });
  return go('targets', { notice: 'Target removed.' });
}
