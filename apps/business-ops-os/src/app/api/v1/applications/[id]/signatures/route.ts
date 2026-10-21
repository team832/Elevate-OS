import { created, defineRoute } from '@elevate/server-kit';
import { confirmSignatures } from '../../../../../../server/applications';
import { signaturesBody } from '../../../../../../server/applications-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/applications/[id]/signatures — Confirm the required physical signatures on the printed form of the current version. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: signaturesBody },
  async ({ user, db, params, body, requestId }) =>
    created(await confirmSignatures(db, user, params.id, body, requestId)),
);
