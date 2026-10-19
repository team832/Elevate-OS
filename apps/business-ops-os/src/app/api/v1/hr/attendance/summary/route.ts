import { defineRoute } from '@elevate/server-kit';
import { monthlyAttendanceSummary } from '../../../../../../server/hr/attendance';
import { summaryQuery } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance/summary?staffId&month=YYYY-MM — monthly summary (self by default). */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: summaryQuery },
  async ({ user, db, query }) => monthlyAttendanceSummary(db, user, query),
);
