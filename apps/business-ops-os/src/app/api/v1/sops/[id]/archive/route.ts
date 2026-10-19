import { created, defineRoute } from '@elevate/server-kit';
import { archiveSop } from '../../../../../../server/sops';
import { idParams } from '../../../../../../server/schemas';
import { sopArchiveBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/sops/[id]/archive — Archive a retired SOP (flag; nothing is deleted). */
export const POST = defineRoute(
  { permission: 'ops:sops:write', params: idParams, body: sopArchiveBody },
  async ({ user, db, params, body, requestId }) =>
    created(await archiveSop(db, user, params.id, body, requestId)),
);
