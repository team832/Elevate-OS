import { defineRoute } from '@elevate/server-kit';
import { exportTimesheetsCsv } from '../../../../../../server/hr/timesheets';
import { timesheetQuery } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/timesheets/export — employee-level CSV (audited). */
export const GET = defineRoute(
  { permission: 'ops:hr_reports:export', query: timesheetQuery },
  async ({ user, db, query, requestId }) => {
    const file = await exportTimesheetsCsv(db, user, query, requestId);
    return new Response(file.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'no-store',
      },
    });
  },
);
