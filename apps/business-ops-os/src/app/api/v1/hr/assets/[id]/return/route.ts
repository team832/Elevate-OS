import { defineRoute } from '@elevate/server-kit';
import { returnAsset } from '../../../../../../../server/hr/assets';
import { returnAssetBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/assets/[id]/return — Record the return and its condition. */
export const POST = defineRoute(
  { permission: 'ops:assets:manage', params: staffIdParams, body: returnAssetBody },
  async ({ user, db, params, body, requestId }) =>
    returnAsset(db, user, params.id, body, requestId),
);
