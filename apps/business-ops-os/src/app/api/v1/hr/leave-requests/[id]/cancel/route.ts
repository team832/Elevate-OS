import { defineRoute } from '@elevate/server-kit';
import { cancelLeaveRequest } from '../../../../../../../server/hr/leave';
import { cancelLeaveBody, timeIdParams } from '../../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/leave-requests/{id}/cancel — cancel (reversal entry when it was approved). */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:leave:request', 'ops:leave:approve'] },
    params: timeIdParams,
    body: cancelLeaveBody,
  },
  async ({ user, db, params, body, requestId }) =>
    cancelLeaveRequest(db, user, params.id, body, requestId),
);
