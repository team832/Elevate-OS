import { created, defineRoute } from '@elevate/server-kit';
import { acknowledgeSop } from '../../../../../../server/sops';
import { idParams } from '../../../../../../server/schemas';
import { acknowledgeBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/sops/[id]/acknowledge — The signed-in person acknowledges the
 * approved version in force (`ops:sops:acknowledge`; only when they are in a required audience; once).
 */
export const POST = defineRoute(
  { permission: 'ops:sops:acknowledge', params: idParams, body: acknowledgeBody },
  async ({ user, db, params, body, requestId }) =>
    created(await acknowledgeSop(db, user, params.id, body, requestId)),
);
