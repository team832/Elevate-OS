import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { submitForReview } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

const body = z.object({ comment: z.string().trim().max(2000).optional() }).strict();

/** POST — draft/changes_requested -> in_review; opens a core approval request bound to the version. */
export const POST = defineRoute(
  { permission: 'marketing:content:write', params: idParams, body },
  async ({ db, params, body, user, requestId }) =>
    submitForReview(db, user, params.id, body.comment ?? null, requestId),
);
