import { created, defineRoute } from '@elevate/server-kit';
import { listCalls } from '../../../../../server/lead-calls';
import { callBody, callListQuery } from '../../../../../server/lead-stages-schemas';
import { logActivity } from '../../../../../server/leads';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads/calls — Logged calls on the leads you may work (filters: dates, direction, outcome, staff, lead). */
export const GET = defineRoute(
  { permission: 'ops:leads:read', query: callListQuery },
  async ({ user, db, query }) => listCalls(db, user, query),
);

/** POST /ops/api/v1/leads/calls — Log a call made from staff's own phone (nothing is dialled or recorded by the app). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: callBody, idempotency: 'optional' },
  async ({ user, db, body: { leadId, ...call }, requestId }) =>
    created(await logActivity(db, user, leadId, { ...call, kind: 'call' }, requestId)),
);
