import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  optimisationReviewBody,
  reviewOptimisationItem,
} from '../../../../../../server/optimisation';

export const dynamic = 'force-dynamic';

/** POST /marketing/api/v1/optimisation/:id/review — approve or ask for changes (never your own work). */
export const POST = defineRoute(
  {
    permission: 'marketing:optimisation:review',
    params: z.object({ id: z.uuid() }),
    body: optimisationReviewBody,
  },
  async ({ db, params, body, user, requestId }) =>
    reviewOptimisationItem(db, user, params.id, body, requestId),
);
