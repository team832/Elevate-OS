import { defineRoute } from '@elevate/server-kit';
import { buildOperationsReport } from '../../../../../server/reports/operations';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/reports/operations — Operations dashboard data (KPIs, capacity, deadlines, errors). */
export const GET = defineRoute({ permission: 'ops:dashboard:read' }, async ({ user, db }) =>
  buildOperationsReport(db, user),
);
