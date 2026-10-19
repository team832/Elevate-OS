import { defineRoute } from '@elevate/server-kit';
import { getOrgChart } from '../../../../../server/hr/org-history';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/organisation/chart — Reporting hierarchy (depth-first rows; loops flagged). */
export const GET = defineRoute({ permission: 'ops:organisation:read' }, async ({ user, db }) =>
  getOrgChart(db, user),
);
