import { defineRoute } from '@elevate/server-kit';
import { recordBreak } from '../../../../../../server/hr/attendance';
import { breakBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/attendance/breaks — start or end a break in the open session (self). */
export const POST = defineRoute(
  { permission: 'ops:attendance:record', body: breakBody },
  async ({ user, db, body, requestId }) => recordBreak(db, user, body.action, requestId),
);
