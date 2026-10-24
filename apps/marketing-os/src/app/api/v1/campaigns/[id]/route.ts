import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import type { CampaignId } from '@elevate/shared-types';
import {
  assertCampaignVisible,
  getCampaignDetail,
  listCampaignMembers,
} from '../../../../../server';
import { updateCampaign, updateCampaignBody } from '../../../../../server/campaigns';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/campaigns/:id — results, placements and members; 404 out of scope. */
export const GET = defineRoute(
  { permission: 'marketing:campaigns:read', params: idParams },
  async ({ db, params, user }) => {
    await assertCampaignVisible(db, user, params.id);
    return {
      ...(await getCampaignDetail(db, params.id as CampaignId)),
      members: await listCampaignMembers(db, params.id),
    };
  },
);

/** PATCH /marketing/api/v1/campaigns/:id — edit fields or change status (audited). */
export const PATCH = defineRoute(
  { permission: 'marketing:campaigns:write', params: idParams, body: updateCampaignBody },
  async ({ db, params, body, user, requestId }) =>
    updateCampaign(db, user, params.id, body, requestId),
);
