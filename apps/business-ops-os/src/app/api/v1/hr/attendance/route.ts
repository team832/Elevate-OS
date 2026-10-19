import { created, defineRoute } from '@elevate/server-kit';
import { createManualSession, listAttendance } from '../../../../../server/hr/attendance';
import { attendanceListQuery, manualSessionBody } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance — staff attendance sessions (HR scope; filters + pagination). */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: attendanceListQuery },
  async ({ user, db, query }) => listAttendance(db, user, query),
);

/** POST /ops/api/v1/hr/attendance — manual entry (reason required, audited). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: manualSessionBody },
  async ({ user, db, body, requestId }) =>
    created(await createManualSession(db, user, body, requestId)),
);
