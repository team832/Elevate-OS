import { defineRoute } from '@elevate/server-kit';
import { cancelLeave } from '../../../../../../server/attendance-actions';
import { cancelLeaveBody } from '../../../../../../server/attendance-schemas';
import { coverClasses } from '../../../../../../server/leave-applications';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave/:id — Cancel approved leave with a reason (audited; never your own); then Academic stops listing the classes as needing cover (D-134). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams, body: cancelLeaveBody },
  async ({ user, db, params, body, requestId }) => {
    const leave = await cancelLeave(db, user, params.id, body, requestId);
    await coverClasses(db, user, leave);
    return leave;
  },
);
