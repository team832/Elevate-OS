import { defineRoute } from '@elevate/server-kit';
import { withdrawApplication } from '../../../../../../server/applications';
import { withdrawBody } from '../../../../../../server/applications-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/applications/[id]/withdraw — The family does not go ahead; the application is kept as withdrawn. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: withdrawBody },
  async ({ user, db, params, body, requestId }) =>
    withdrawApplication(db, user, params.id, body, requestId),
);
