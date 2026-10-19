import { defineRoute } from '@elevate/server-kit';
import { updateShiftAssignment } from '../../../../../../server/hr/shifts';
import { timeIdParams, updateAssignmentBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/shift-assignments/{id} — end on a date or cancel (reason). */
export const PATCH = defineRoute(
  { permission: 'ops:shifts:manage', params: timeIdParams, body: updateAssignmentBody },
  async ({ user, db, params, body, requestId }) =>
    updateShiftAssignment(db, user, params.id, body, requestId),
);
