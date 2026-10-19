import { defineRoute } from '@elevate/server-kit';
import { feeApprovalAction } from '../../../../../../server/admissions';
import { feeApprovalBody, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/fee-approval — Request, approve, reject or withdraw the fee-arrangement approval. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:admissions:write', 'ops:admissions:approve'] },
    params: idParams,
    body: feeApprovalBody,
  },
  async ({ user, db, params, body, requestId }) =>
    feeApprovalAction(db, user, params.id, body, requestId),
);
