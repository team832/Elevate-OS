import { created, defineRoute } from '@elevate/server-kit';
import { messageDraftBody } from '../../../../../../server/appointments-schemas';
import { draftEventMessage } from '../../../../../../server/events';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/appointments/:id/messages — Draft a message and preview who it can reach; sends nothing. */
export const POST = defineRoute(
  { permission: 'ops:appointments:manage', params: idParams, body: messageDraftBody },
  async ({ user, db, params, body, requestId }) =>
    created(await draftEventMessage(db, user, params.id, body, requestId)),
);
