import { defineRoute } from '@elevate/server-kit';
import { updateLeaveType } from '../../../../../../server/hr/leave';
import { timeIdParams, updateLeaveTypeBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/leave-types/{id} */
export const PATCH = defineRoute(
  { permission: 'ops:leave:manage', params: timeIdParams, body: updateLeaveTypeBody },
  async ({ user, db, params, body, requestId }) =>
    updateLeaveType(db, user, params.id, body, requestId),
);
