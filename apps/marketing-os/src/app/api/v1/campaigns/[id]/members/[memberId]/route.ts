import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { endCampaignMember, endMemberBody } from '../../../../../../../server';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid(), memberId: z.uuid() });

/** PATCH /marketing/api/v1/campaigns/:id/members/:memberId — end a membership (history kept). */
export const PATCH = defineRoute(
  { permission: 'marketing:campaigns:write', params, body: endMemberBody },
  async ({ db, params, body, user, requestId }) =>
    endCampaignMember(db, user, params.id, params.memberId, body, requestId),
);
