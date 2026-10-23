'use server';

import { z } from 'zod';
import { addCampaignMember, addMemberBody, endCampaignMember } from '../../server';
import { go, run, str } from './common';

/** The campaign id from the form; a malformed id reads as "not found". */
function campaignOf(form: FormData): string {
  const id = str(form, 'campaignId') ?? '';
  if (!z.uuid().safeParse(id).success) go('campaigns', { error: 'Campaign not found.' });
  return id;
}

export async function addCampaignMemberAction(form: FormData): Promise<void> {
  const campaignId = campaignOf(form);
  const back = `campaigns/${campaignId}`;
  const parsed = addMemberBody.safeParse({
    staffId: str(form, 'staffId'),
    role: str(form, 'role'),
    fromDate: str(form, 'fromDate'),
  });
  if (!parsed.success) go(back, { error: parsed.error.issues.map((i) => i.message).join('; ') });
  const res = await run((db, user) => addCampaignMember(db, user, campaignId, parsed.data));
  if (!res.ok) go(back, { error: res.error });
  go(back, { notice: 'Member added.' });
}

export async function endCampaignMemberAction(form: FormData): Promise<void> {
  const campaignId = campaignOf(form);
  const back = `campaigns/${campaignId}`;
  const memberId = str(form, 'memberId') ?? '';
  if (!z.uuid().safeParse(memberId).success) go(back, { error: 'Member not found.' });
  const res = await run((db, user) =>
    endCampaignMember(db, user, campaignId, memberId, {
      toDate: str(form, 'toDate'),
    }),
  );
  if (!res.ok) go(back, { error: res.error });
  go(back, { notice: 'Membership ended. It stays in the history.' });
}
