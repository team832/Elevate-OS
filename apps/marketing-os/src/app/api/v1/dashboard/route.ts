import { defineRoute } from '@elevate/server-kit';
import { loadDashboard } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/dashboard — honest counts (items by state, approvals, schedule, integrations). */
export const GET = defineRoute({ permission: 'marketing:content:read' }, async ({ db }) =>
  loadDashboard(db),
);
