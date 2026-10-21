import { defineRoute } from '@elevate/server-kit';
import { getDemo, updateDemo } from '../../../../../server/demos';
import { demoActionBody } from '../../../../../server/demos-schemas';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/demos/[id] — The demo record (days and classes, history, KYC, demo fee, teacher reviews, checklist, follow-ups, activity). */
export const GET = defineRoute(
  { permission: 'ops:leads:read', params: idParams },
  async ({ user, db, params }) => getDemo(db, user, params.id),
);

/** POST /ops/api/v1/demos/[id] — Close the demo with a manual outcome and a reason, or update its KYC. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: demoActionBody },
  async ({ user, db, params, body, requestId }) => updateDemo(db, user, params.id, body, requestId),
);
