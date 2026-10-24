import { defineRoute } from '@elevate/server-kit';
import { monthlyReportQuery, monthlySnapshotFor } from '../../../../../server/monthly-report';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/reports/monthly?month=YYYY-MM&staffId — live marketing facts (own scope: yours). */
export const GET = defineRoute(
  { permission: 'marketing:reports:read', query: monthlyReportQuery },
  async ({ db, query, user }) => monthlySnapshotFor(db, user, query),
);
