import { created, defineRoute } from '@elevate/server-kit';
import { createIncident, listIncidents } from '../../../../server/incidents';
import { incidentBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/incidents — Exceptions and incidents. */
export const GET = defineRoute({ permission: 'ops:incidents:read' }, async ({ user, db }) =>
  listIncidents(db, user),
);

/** POST /ops/api/v1/incidents — Record an exception or incident. */
export const POST = defineRoute(
  { permission: 'ops:incidents:write', body: incidentBody },
  async ({ user, db, body, requestId }) => created(await createIncident(db, user, body, requestId)),
);
