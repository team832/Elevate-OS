import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { addComment, commentBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — append a comment (contributors, managers and approvers). */
export const POST = defineRoute(
  {
    permission: { anyOf: ['marketing:content:write', 'marketing:content:approve'] },
    params: idParams,
    body: commentBody,
  },
  async ({ db, params, body, user, requestId }) =>
    created(await addComment(db, user, params.id, body, requestId)),
);
