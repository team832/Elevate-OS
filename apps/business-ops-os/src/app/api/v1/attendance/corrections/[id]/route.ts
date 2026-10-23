import { defineRoute } from '@elevate/server-kit';
import { decideCorrection } from '../../../../../../server/attendance-corrections';
import { correctionDecisionBody } from '../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/corrections/:id — HR approves (applies the change) or rejects (note required) a request; never your own. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams, body: correctionDecisionBody },
  async ({ user, db, params, body, requestId }) =>
    decideCorrection(db, user, params.id, body, requestId),
);
