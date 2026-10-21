import { created, defineRoute } from '@elevate/server-kit';
import { addDemoSession } from '../../../../../../server/demos';
import { addSessionBody } from '../../../../../../server/demos-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/demos/[id]/sessions — Add a class to a demo day (a day beyond the booked count only under "Extra demo days"). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: addSessionBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addDemoSession(db, user, params.id, body, requestId)),
);
