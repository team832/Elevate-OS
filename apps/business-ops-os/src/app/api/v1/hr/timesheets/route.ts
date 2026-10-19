import { defineRoute } from '@elevate/server-kit';
import { buildTimesheets } from '../../../../../server/hr/timesheets';
import { timesheetQuery } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/timesheets?from&to&staffId&departmentId — period summaries (daily rows for one employee). */
export const GET = defineRoute(
  { permission: 'ops:hr_reports:read', query: timesheetQuery },
  async ({ user, db, query }) => buildTimesheets(db, user, query),
);
