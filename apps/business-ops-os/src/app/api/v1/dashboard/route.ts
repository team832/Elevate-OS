import { defineRoute } from '@elevate/server-kit';
import { buildDashboard } from '../../../../server/dashboard';
import { dashboardQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/dashboard — KPIs, workload and cross-module panels. */
export const GET = defineRoute(
  { permission: 'ops:dashboard:read', query: dashboardQuery },
  async ({ user, db, query }) => buildDashboard(db, user, { window: query }),
);
