import { defineRoute } from '@elevate/server-kit';
import { assignSchedule } from '../../../../../server/attendance-actions';
import { assignScheduleBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/schedule-assignments — Choose the schedule a staff member follows (null = the default one). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: assignScheduleBody },
  async ({ user, db, body, requestId }) => assignSchedule(db, user, body, requestId),
);
