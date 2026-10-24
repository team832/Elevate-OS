import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { submitOptimisationItem } from '../../../../../../server/optimisation';

export const dynamic = 'force-dynamic';

/** POST /marketing/api/v1/optimisation/:id/submit — send for review (evidence required). */
export const POST = defineRoute(
  { permission: 'marketing:optimisation:write', params: z.object({ id: z.uuid() }) },
  async ({ db, params, user, requestId }) => submitOptimisationItem(db, user, params.id, requestId),
);
