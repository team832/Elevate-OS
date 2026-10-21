import { defineRoute } from '@elevate/server-kit';
import { markReady } from '../../../../../../server/applications';
import { versionBody } from '../../../../../../server/applications-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/applications/[id]/ready — Mark the reviewed version complete (draft → ready for review). */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: versionBody },
  async ({ user, db, params, body, requestId }) => markReady(db, user, params.id, body, requestId),
);
