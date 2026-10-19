import { created, defineRoute } from '@elevate/server-kit';
import { assignAsset } from '../../../../../../../server/hr/assets';
import { assignAssetBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/assets/[id]/assign — Assign to an employee (one open assignment per asset). */
export const POST = defineRoute(
  { permission: 'ops:assets:manage', params: staffIdParams, body: assignAssetBody },
  async ({ user, db, params, body, requestId }) =>
    created(await assignAsset(db, user, params.id, body, requestId)),
);
