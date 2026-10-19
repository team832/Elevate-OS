import { defineRoute } from '@elevate/server-kit';
import { transferOwnership } from '../../../../../../../../../server/hr/offboarding';
import {
  caseItemParams,
  transferBody,
} from '../../../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/lifecycle-cases/{id}/items/{itemId}/transfer — Hand a record over and complete the item. */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:manage', params: caseItemParams, body: transferBody },
  async ({ user, db, params, body, requestId }) =>
    transferOwnership(db, user, params.id, params.itemId, body.targetStaffId, requestId),
);
