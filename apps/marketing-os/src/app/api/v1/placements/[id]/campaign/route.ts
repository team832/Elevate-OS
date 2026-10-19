import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { placementCampaignBody, setPlacementCampaign } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** PUT — attach to (or detach from) a campaign. */
export const PUT = defineRoute(
  { permission: 'marketing:campaigns:write', params: idParams, body: placementCampaignBody },
  async ({ db, params, body, user, requestId }) =>
    setPlacementCampaign(db, user, params.id, body.campaignId, requestId),
);
