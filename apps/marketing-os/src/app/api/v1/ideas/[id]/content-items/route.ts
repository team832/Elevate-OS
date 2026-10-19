import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { createContentItem, createContentItemBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST /marketing/api/v1/ideas/:id/content-items — 201 draft content item (optional first version). */
export const POST = defineRoute(
  {
    permission: 'marketing:content:write',
    params: idParams,
    body: createContentItemBody,
    idempotency: 'optional',
  },
  async ({ db, params, body, user, requestId }) =>
    created(await createContentItem(db, user, params.id, body, requestId)),
);
