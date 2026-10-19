import { created, defineRoute } from '@elevate/server-kit';
import { clockIn } from '../../../../../../server/hr/attendance';
import { clockBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/attendance/clock-in — clock in now (self). */
export const POST = defineRoute(
  { permission: 'ops:attendance:record', body: clockBody },
  async ({ user, db, body, requestId }) => created(await clockIn(db, user, body, requestId)),
);
