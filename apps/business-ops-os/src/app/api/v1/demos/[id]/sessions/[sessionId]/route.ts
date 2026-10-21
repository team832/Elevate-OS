import { defineRoute } from '@elevate/server-kit';
import { updateDemoSession } from '../../../../../../../server/demos';
import { sessionActionBody, sessionParams } from '../../../../../../../server/demos-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/demos/[id]/sessions/[sessionId] — Attendance, reschedule, cancel, mock, teacher. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: sessionParams, body: sessionActionBody },
  async ({ user, db, params, body, requestId }) =>
    updateDemoSession(db, user, params.id, params.sessionId, body, requestId),
);
