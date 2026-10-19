import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { changeIdeaStatus, ideaStatusBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST /marketing/api/v1/ideas/:id/status — MKT-004 lifecycle. */
export const POST = defineRoute(
  { permission: 'marketing:ideas:write', params: idParams, body: ideaStatusBody },
  async ({ db, params, body, user, requestId }) =>
    changeIdeaStatus(db, user, params.id, body, requestId),
);
