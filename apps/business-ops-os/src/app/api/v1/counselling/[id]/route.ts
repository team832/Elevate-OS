import { defineRoute } from '@elevate/server-kit';
import { updateCounselling } from '../../../../../server/schedule';
import { counsellingUpdateBody, idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/counselling/[id] — Complete, no-show or cancel a counselling session. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: counsellingUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateCounselling(db, user, params.id, body, requestId),
);
