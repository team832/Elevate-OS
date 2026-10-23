import { defineRoute } from '@elevate/server-kit';
import { cancelLeave } from '../../../../../../server/attendance-actions';
import { cancelLeaveBody } from '../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave/:id — Cancel approved leave with a reason (audited; never your own). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams, body: cancelLeaveBody },
  async ({ user, db, params, body, requestId }) =>
    cancelLeave(db, user, params.id, body, requestId),
);
