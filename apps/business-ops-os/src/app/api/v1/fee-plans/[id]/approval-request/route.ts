import { created, defineRoute } from '@elevate/server-kit';
import { feePlanApprovalRequestBody, requestFeePlanApproval } from '../../../../../../server/fees';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/fee-plans/[id]/approval-request — Ask for the fee-arrangement approval of a draft agreement (a different person decides it). */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: feePlanApprovalRequestBody },
  async ({ user, db, params, body, requestId }) =>
    created(await requestFeePlanApproval(db, user, params.id, body, requestId)),
);
