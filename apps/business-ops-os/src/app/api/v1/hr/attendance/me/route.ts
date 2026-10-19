import { defineRoute } from '@elevate/server-kit';
import { myAttendanceStatus } from '../../../../../../server/hr/attendance';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance/me — my open session, running break and today's sessions. */
export const GET = defineRoute({ permission: 'ops:attendance:record' }, async ({ user, db }) =>
  myAttendanceStatus(db, user),
);
