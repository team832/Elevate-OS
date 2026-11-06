import { defineRoute } from '@elevate/server-kit';
import { assetReturnBody, returnAsset } from '../../../../../../../server/hr-staff-records';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/assets/:id/return — record the return (date, condition) (F4-09). */
export const POST = defineRoute(
  { permission: 'ops:staff:manage', params: idParams, body: assetReturnBody },
  async ({ user, db, params, body, requestId }) =>
    returnAsset(db, user, params.id, body, requestId),
);
