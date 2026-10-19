import { created, defineRoute } from '@elevate/server-kit';
import { createCampaign, createCampaignBody, listCampaigns } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/campaigns */
export const GET = defineRoute({ permission: 'marketing:content:read' }, async ({ db }) =>
  listCampaigns(db),
);

/** POST /marketing/api/v1/campaigns — organic campaign (paid campaigns are Proposed). */
export const POST = defineRoute(
  { permission: 'marketing:campaigns:write', body: createCampaignBody },
  async ({ db, body, user, requestId }) => created(await createCampaign(db, user, body, requestId)),
);
