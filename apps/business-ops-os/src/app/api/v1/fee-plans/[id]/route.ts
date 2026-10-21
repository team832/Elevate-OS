import { defineRoute } from '@elevate/server-kit';
import { feePlanAction, feePlanActionBody } from '../../../../../server/fees';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/fee-plans/[id] — `activate` (needs the approved fee arrangement), `close`
 * (reason) or `adjust` (new version with a reason; an active agreement also needs ops:admissions:approve).
 */
export const POST = defineRoute(
  {
    permission: 'ops:fees:record',
    params: idParams,
    body: feePlanActionBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    feePlanAction(db, user, params.id, body, requestId),
);
