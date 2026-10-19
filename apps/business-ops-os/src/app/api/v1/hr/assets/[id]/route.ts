import { defineRoute } from '@elevate/server-kit';
import { getAsset, updateAsset } from '../../../../../../server/hr/assets';
import { staffIdParams, updateAssetBody } from '../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/assets/[id] — Asset with its assignment history. */
export const GET = defineRoute(
  { permission: 'ops:assets:read', params: staffIdParams },
  async ({ user, db, params }) => getAsset(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/assets/[id] — Edit an asset or change its status (repair, retire, lost). */
export const PATCH = defineRoute(
  { permission: 'ops:assets:manage', params: staffIdParams, body: updateAssetBody },
  async ({ user, db, params, body, requestId }) =>
    updateAsset(db, user, params.id, body, requestId),
);
