import { created, defineRoute } from '@elevate/server-kit';
import { saveSchedule } from '../../../../../server/attendance-actions';
import { scheduleBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/schedules — Create a weekly work schedule (hours per weekday, null = weekly off). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: scheduleBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) =>
    created(await saveSchedule(db, user, body, undefined, requestId)),
);
