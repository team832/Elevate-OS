import { created, defineRoute } from '@elevate/server-kit';
import { recordLeave } from '../../../../../server/attendance-actions';
import { leaveBody } from '../../../../../server/attendance-schemas';
import { coverClasses } from '../../../../../server/leave-applications';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/attendance/leave — HR records approved leave (dates inclusive), within setting
 * hr.leave_approver; never over approved leave (409), so a repeat cannot double it. No idempotency
 * transaction: Academic is told after the commit (D-134), never inside one.
 */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: leaveBody },
  async ({ user, db, body, requestId }) => {
    const leave = await recordLeave(db, user, body, requestId);
    await coverClasses(db, user, leave);
    return created(leave);
  },
);
