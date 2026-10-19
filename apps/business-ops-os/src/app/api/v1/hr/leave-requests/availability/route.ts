import { defineRoute } from '@elevate/server-kit';
import { teamAvailability } from '../../../../../../server/hr/leave';
import { availabilityQuery } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-requests/availability?from&to&departmentId — who is on leave / scheduled per day. */
export const GET = defineRoute(
  { permission: 'ops:leave:read', query: availabilityQuery },
  async ({ user, db, query }) => teamAvailability(db, user, query),
);
