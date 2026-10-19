import { defineRoute } from '@elevate/server-kit';
import { updateRisk } from '../../../../../server/planning';
import { idParams, updateRiskBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/risks/[id] — Update a risk. */
export const PATCH = defineRoute(
  { permission: 'ops:risks:write', params: idParams, body: updateRiskBody },
  async ({ user, db, params, body, requestId }) => updateRisk(db, user, params.id, body, requestId),
);
