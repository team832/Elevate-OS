import { defineRoute } from '@elevate/server-kit';
import { getLeaveRequest } from '../../../../../../server/hr/leave';
import { timeIdParams } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/leave-requests/{id} — request, day-by-day count and ledger entries. */
export const GET = defineRoute(
  { permission: 'ops:leave:read', params: timeIdParams },
  async ({ user, db, params }) => getLeaveRequest(db, user, params.id),
);
