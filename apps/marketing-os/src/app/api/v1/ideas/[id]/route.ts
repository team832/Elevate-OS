import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { getIdeaDetail, updateIdea, updateIdeaBody } from '../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/ideas/:id — idea, content items, placements, live duplicate candidates. */
export const GET = defineRoute(
  { permission: 'marketing:ideas:read', params: idParams },
  async ({ db, params }) => getIdeaDetail(db, params.id),
);

/** PATCH /marketing/api/v1/ideas/:id */
export const PATCH = defineRoute(
  { permission: 'marketing:ideas:write', params: idParams, body: updateIdeaBody },
  async ({ db, params, body, user, requestId }) => updateIdea(db, user, params.id, body, requestId),
);
