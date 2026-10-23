import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import {
  addCampaignMember,
  addMemberBody,
  assertCampaignVisible,
  listCampaignMembers,
} from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/campaigns/:id/members — current and past members; 404 out of scope. */
export const GET = defineRoute(
  { permission: 'marketing:campaigns:read', params: idParams },
  async ({ db, params, user }) => {
    await assertCampaignVisible(db, user, params.id);
    return listCampaignMembers(db, params.id);
  },
);

/** POST /marketing/api/v1/campaigns/:id/members — add an owner or member (marketing manager). */
export const POST = defineRoute(
  { permission: 'marketing:campaigns:write', params: idParams, body: addMemberBody },
  async ({ db, params, body, user, requestId }) =>
    created(await addCampaignMember(db, user, params.id, body, requestId)),
);
