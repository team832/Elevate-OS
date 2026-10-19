import { defineRoute } from '@elevate/server-kit';
import { getAttendanceSession } from '../../../../../../server/hr/attendance';
import { timeIdParams } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance/{id} — session, breaks, corrections and supersede chain. */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', params: timeIdParams },
  async ({ user, db, params }) => getAttendanceSession(db, user, params.id),
);
