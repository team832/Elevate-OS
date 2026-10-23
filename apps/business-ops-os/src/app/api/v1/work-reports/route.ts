import { defineRoute } from '@elevate/server-kit';
import { workReportListQuery } from '../../../../server/eod-schemas';
import { workReportList } from '../../../../server/work-reports';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/work-reports?kind=day|week|month&date=&standing=&q=&departmentId=&page= — Work reports of the staff HR manages for one period, "Missing" when due and not submitted. */
export const GET = defineRoute(
  { permission: 'ops:work_reports:read', query: workReportListQuery },
  async ({ user, db, query }) => workReportList(db, user, query),
);
