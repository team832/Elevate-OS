import { created, defineRoute } from '@elevate/server-kit';
import { applyForLeave, listLeaveApplications } from '../../../../../server/leave-applications';
import { leaveApplicationBody, leaveListQuery } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/attendance/leave-applications — Leave applications with a count per status; own scope = your own, HR = its staff scope. */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: leaveListQuery },
  async ({ user, db, query }) => listLeaveApplications(db, user, query),
);

/** POST <base>/api/v1/attendance/leave-applications — Apply for your own leave (reason required; overlapping your own pending or approved application is 409; no staff record is 400). */
export const POST = defineRoute(
  { permission: 'ops:attendance:request', body: leaveApplicationBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await applyForLeave(db, user, body, requestId)),
);
