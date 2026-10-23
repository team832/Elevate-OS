import { defineRoute } from '@elevate/server-kit';
import { listAttendance } from '../../../../server/attendance';
import { attendanceListQuery } from '../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/attendance — Staff days in a range (default the last 7 days, at most 62): status, first in, last out, late minutes, missing check-out and why a day needs review; own scope = your own days (another person's id → 404). */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: attendanceListQuery },
  async ({ user, db, query }) => listAttendance(db, user, query),
);
