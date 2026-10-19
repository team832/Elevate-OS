import { defineRoute } from '@elevate/server-kit';
import { handleEscalation } from '../../../../../server/escalations';
import { escalationActionBody, idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/escalations/[id] — Acknowledge or resolve an escalation. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: escalationActionBody },
  async ({ user, db, params, body, requestId }) =>
    handleEscalation(db, user, params.id, body, requestId),
);
