import { defineRoute } from '@elevate/server-kit';
import { updateHoliday } from '../../../../../../server/hr/shifts';
import { timeIdParams, updateHolidayBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/holidays/{id} — mark approved / proposed / withdrawn. */
export const PATCH = defineRoute(
  { permission: 'ops:leave:manage', params: timeIdParams, body: updateHolidayBody },
  async ({ user, db, params, body, requestId }) =>
    updateHoliday(db, user, params.id, body, requestId),
);
