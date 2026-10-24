'use server';

import { z } from 'zod';
import { updateCampaign, updateCampaignBody } from '../../server/campaigns';
import { go, run, str, strs } from '../actions/common';

export async function updateCampaignAction(form: FormData): Promise<void> {
  const id = str(form, 'campaignId') ?? '';
  if (!z.uuid().safeParse(id).success) go('campaigns', { error: 'Campaign not found.' });
  const back = `campaigns/${id}`;
  const parsed = updateCampaignBody.safeParse({
    name: str(form, 'name'),
    objective: str(form, 'objective') ?? null,
    startsOn: str(form, 'startsOn') ?? null,
    endsOn: str(form, 'endsOn') ?? null,
    status: str(form, 'status'),
    programmeId: str(form, 'programmeId') ?? null,
    audience: str(form, 'audience') ?? null,
    channels: strs(form, 'channels'),
  });
  if (!parsed.success)
    go(back, {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  const res = await run((db, user) => updateCampaign(db, user, id, parsed.data));
  if (!res.ok) go(back, { error: res.error });
  go(back, { notice: 'Campaign saved.' });
}
