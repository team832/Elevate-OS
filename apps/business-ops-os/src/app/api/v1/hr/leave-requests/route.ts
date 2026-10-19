import { created, defineRoute } from '@elevate/server-kit';
import { createLeaveRequest, listLeaveRequests } from '../../../../../server/hr/leave';
import { createLeaveBody, leaveListQuery } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-requests — views mine / to_decide / all (HR scope). */
export const GET = defineRoute(
  { permission: 'ops:leave:read', query: leaveListQuery },
  async ({ user, db, query }) => listLeaveRequests(db, user, query),
);

/** POST /ops/api/v1/hr/leave-requests — request leave (LVR-######); overlaps → 409. */
export const POST = defineRoute(
  { permission: 'ops:leave:request', body: createLeaveBody },
  async ({ user, db, body, requestId }) =>
    created(await createLeaveRequest(db, user, body, requestId)),
);
