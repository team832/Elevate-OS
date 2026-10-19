import { defineRoute } from '@elevate/server-kit';
import { clockOut } from '../../../../../../server/hr/attendance';
import { clockBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/attendance/clock-out — clock out now (self); ends a running break. */
export const POST = defineRoute(
  { permission: 'ops:attendance:record', body: clockBody },
  async ({ user, db, body, requestId }) => clockOut(db, user, body, requestId),
);
