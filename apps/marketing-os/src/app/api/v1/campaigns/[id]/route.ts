import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import type { CampaignId } from '@elevate/shared-types';
import {
  assertCampaignVisible,
  getCampaignDetail,
  listCampaignMembers,
} from '../../../../../server';

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
