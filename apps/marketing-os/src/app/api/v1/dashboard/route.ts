import { ForbiddenError, defineRoute } from '@elevate/server-kit';
import { loadDashboard, teamWide } from '../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /marketing/api/v1/dashboard — honest counts (items by state, approvals, schedule,
 * integrations) across the whole module, so only for team-wide readers (marketing employees use My day).
 */
export const GET = defineRoute({ permission: 'marketing:content:read' }, async ({ db, user }) => {
  if (!teamWide(user)) throw new ForbiddenError('The marketing overview is for managers.');
  return loadDashboard(db);
});
