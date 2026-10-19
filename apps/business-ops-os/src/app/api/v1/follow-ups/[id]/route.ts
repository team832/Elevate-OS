import { defineRoute } from '@elevate/server-kit';
import { closeFollowUp } from '../../../../../server/follow-ups';
import { followUpCloseBody, idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/follow-ups/[id] — Complete or cancel a follow-up with an outcome. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: followUpCloseBody },
  async ({ user, db, params, body, requestId }) =>
    closeFollowUp(db, user, params.id, body, requestId),
);
