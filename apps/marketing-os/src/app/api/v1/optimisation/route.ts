import { created, defineRoute } from '@elevate/server-kit';
import {
  createOptimisationItem,
  listOptimisationItems,
  optimisationCreateBody,
  optimisationListQuery,
} from '../../../../server/optimisation';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/optimisation?category&state — SEO/AIO/GEO work items (all of Marketing reads them). */
export const GET = defineRoute(
  { permission: 'marketing:optimisation:read', query: optimisationListQuery },
  async ({ db, query }) => listOptimisationItems(db, query),
);

/** POST /marketing/api/v1/optimisation — new work item with its checklist (employees: their own). */
export const POST = defineRoute(
  {
    permission: 'marketing:optimisation:write',
    body: optimisationCreateBody,
    idempotency: 'optional',
  },
  async ({ db, body, user, requestId }) =>
    created(await createOptimisationItem(db, user, body, requestId)),
);
