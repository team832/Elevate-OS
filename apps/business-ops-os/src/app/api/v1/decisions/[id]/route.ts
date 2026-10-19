import { defineRoute } from '@elevate/server-kit';
import { updateDecision } from '../../../../../server/planning';
import { idParams, updateDecisionBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/decisions/[id] — Update a decision (superseded needs supersededById). */
export const PATCH = defineRoute(
  { permission: 'ops:decisions:write', params: idParams, body: updateDecisionBody },
  async ({ user, db, params, body, requestId }) =>
    updateDecision(db, user, params.id, body, requestId),
);
