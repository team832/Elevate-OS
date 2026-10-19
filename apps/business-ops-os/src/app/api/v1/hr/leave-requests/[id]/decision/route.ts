import { defineRoute } from '@elevate/server-kit';
import { decideLeaveRequest } from '../../../../../../../server/hr/leave';
import { decisionBody, timeIdParams } from '../../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/leave-requests/{id}/decision — approve (writes a usage entry) or reject. */
export const POST = defineRoute(
  { permission: 'ops:leave:approve', params: timeIdParams, body: decisionBody },
  async ({ user, db, params, body, requestId }) =>
    decideLeaveRequest(db, user, params.id, body, requestId),
);
