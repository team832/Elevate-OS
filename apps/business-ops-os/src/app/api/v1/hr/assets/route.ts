import { created, defineRoute } from '@elevate/server-kit';
import { createAsset, listAssets } from '../../../../../server/hr/assets';
import { assetListQuery, createAssetBody } from '../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/assets — Asset register (own scope: assets of staff in your HR scope). */
export const GET = defineRoute(
  { permission: 'ops:assets:read', query: assetListQuery },
  async ({ user, db, query }) => listAssets(db, user, query),
);

/** POST /ops/api/v1/hr/assets — Register an asset (AST-#####). */
export const POST = defineRoute(
  { permission: 'ops:assets:manage', body: createAssetBody },
  async ({ user, db, body, requestId }) => created(await createAsset(db, user, body, requestId)),
);
