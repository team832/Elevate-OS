import { defineRoute } from '@elevate/server-kit';
import { cancelLeaveApplication } from '../../../../../../../server/leave-applications';
import { leaveCancelBody } from '../../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST <base>/api/v1/attendance/leave-applications/:id/cancel — The applicant cancels while pending; HR cancels approved leave with a reason (Proposed), which removes it from attendance. */
export const POST = defineRoute(
  { permission: 'ops:attendance:request', params: idParams, body: leaveCancelBody },
  async ({ user, db, params, body, requestId }) =>
    cancelLeaveApplication(db, user, params.id, body, requestId),
);
