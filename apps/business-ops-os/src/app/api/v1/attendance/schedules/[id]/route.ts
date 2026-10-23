import { defineRoute } from '@elevate/server-kit';
import { saveSchedule } from '../../../../../../server/attendance-actions';
import { scheduleBody } from '../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/attendance/schedules/:id — Replace a schedule's name, hours, grace and default flag. */
export const PUT = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams, body: scheduleBody },
  async ({ user, db, params, body, requestId }) =>
    saveSchedule(db, user, body, params.id, requestId),
);
