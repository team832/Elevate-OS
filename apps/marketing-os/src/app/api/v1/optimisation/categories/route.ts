import { defineRoute } from '@elevate/server-kit';
import { listOptimisationCategories } from '../../../../../server/optimisation';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/optimisation/categories — configured categories and their meanings. */
export const GET = defineRoute({ permission: 'marketing:optimisation:read' }, async ({ db }) =>
  listOptimisationCategories(db),
);
