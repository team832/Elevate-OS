import { created, defineRoute } from '@elevate/server-kit';
import {
  campaignFilter,
  createCampaign,
  createCampaignBody,
  listCampaigns,
} from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/campaigns — a marketing employee gets only the campaigns they are on. */
export const GET = defineRoute({ permission: 'marketing:campaigns:read' }, async ({ db, user }) =>
  listCampaigns(db, await campaignFilter(db, user)),
);

/** POST /marketing/api/v1/campaigns — organic campaign (paid campaigns are Proposed). */
export const POST = defineRoute(
  { permission: 'marketing:campaigns:write', body: createCampaignBody },
  async ({ db, body, user, requestId }) => created(await createCampaign(db, user, body, requestId)),
);
