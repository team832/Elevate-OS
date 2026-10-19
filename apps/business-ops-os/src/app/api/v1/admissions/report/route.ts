import { defineRoute } from '@elevate/server-kit';
import { admissionsReportQuery } from '../../../../../server/admissions-schemas';
import { buildAdmissionsReport } from '../../../../../server/reports/admissions';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions/report?from=&to= — Admissions KPIs (own scope for counsellors). */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', query: admissionsReportQuery },
  async ({ user, db, query }) => buildAdmissionsReport(db, user, query),
);
