import { defineRoute } from '@elevate/server-kit';
import { messageParams } from '../../../../../../../server/appointments-schemas';
import { sendEventMessage } from '../../../../../../../server/events';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/appointments/:id/messages/:messageId — Send a drafted message (no provider → simulated, never sent). */
export const POST = defineRoute(
  { permission: 'ops:event_messages:send', params: messageParams },
  async ({ user, db, params, requestId }) =>
    sendEventMessage(db, user, params.id, params.messageId, requestId),
);
