import { defineRoute } from '@elevate/server-kit';
import { decideFeePlan, feePlanDecisionBody } from '../../../../../../server/fees';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/fee-plans/[id]/decision — Approve (activates) or reject a draft agreement's pending fee-arrangement request; never the requester or the person who made it. */
export const POST = defineRoute(
  { permission: 'ops:admissions:approve', params: idParams, body: feePlanDecisionBody },
  async ({ user, db, params, body, requestId }) =>
    decideFeePlan(db, user, params.id, body, requestId),
);
