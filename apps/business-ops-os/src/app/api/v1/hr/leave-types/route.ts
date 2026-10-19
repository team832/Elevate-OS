import { created, defineRoute } from '@elevate/server-kit';
import { createLeaveType, listLeaveTypes } from '../../../../../server/hr/leave';
import { createLeaveTypeBody, leaveTypeListQuery } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-types */
export const GET = defineRoute(
  { permission: 'ops:leave:read', query: leaveTypeListQuery },
  async ({ user, db, query }) => listLeaveTypes(db, user, query.includeRetired === 'true'),
);

/** POST /ops/api/v1/hr/leave-types — new leave type (starts proposed, OD-026). */
export const POST = defineRoute(
  { permission: 'ops:leave:manage', body: createLeaveTypeBody },
  async ({ user, db, body, requestId }) =>
    created(await createLeaveType(db, user, body, requestId)),
);
