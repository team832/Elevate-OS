import { defineRoute } from '@elevate/server-kit';
import { feeStructureUpdateBody, updateFeeStructure } from '../../../../../server/fees';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/fee-structures/[id] — Edit a fee; owner-approved/approved needs the approval permission and a reason. */
export const PATCH = defineRoute(
  { permission: 'ops:fees:record', params: idParams, body: feeStructureUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateFeeStructure(db, user, params.id, body, requestId),
);
