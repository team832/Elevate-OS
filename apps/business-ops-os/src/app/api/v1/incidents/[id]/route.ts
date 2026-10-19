import { defineRoute } from '@elevate/server-kit';
import { updateIncident } from '../../../../../server/incidents';
import { idParams, incidentUpdateBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/incidents/[id] — Update status/owner/resolution. */
export const PATCH = defineRoute(
  { permission: 'ops:incidents:write', params: idParams, body: incidentUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateIncident(db, user, params.id, body, requestId),
);
