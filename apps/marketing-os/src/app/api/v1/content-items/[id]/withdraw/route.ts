import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { withdrawFromReview } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — in_review -> draft (the requester withdraws the approval request). */
export const POST = defineRoute(
  { permission: 'marketing:content:write', params: idParams },
  async ({ db, params, user, requestId }) => withdrawFromReview(db, user, params.id, requestId),
);
