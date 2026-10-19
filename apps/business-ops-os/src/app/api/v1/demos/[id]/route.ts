import { defineRoute } from '@elevate/server-kit';
import { updateDemo } from '../../../../../server/schedule';
import { demoUpdateBody, idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/demos/[id] — Attended, missed, cancel, or record the demo fee status. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: demoUpdateBody },
  async ({ user, db, params, body, requestId }) => updateDemo(db, user, params.id, body, requestId),
);
