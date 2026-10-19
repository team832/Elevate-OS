import { created, defineRoute } from '@elevate/server-kit';
import { createLead, listLeads } from '../../../../server/leads';
import { createLeadBody, listLeadsQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads — List leads (own scope for counsellors). */
export const GET = defineRoute(
  { permission: 'ops:leads:read', query: listLeadsQuery },
  async ({ user, db, query }) => listLeads(db, user, query),
);

/** POST /ops/api/v1/leads — Create a lead + first enquiry + admission case; 409 CONFLICT with details.duplicates on an exact duplicate unless acknowledged. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: createLeadBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await createLead(db, user, body, requestId)),
);
