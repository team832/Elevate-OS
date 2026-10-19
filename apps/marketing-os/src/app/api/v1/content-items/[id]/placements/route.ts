import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { createPlacement, createPlacementBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — plan a placement <IDEA>-<ACCOUNT>[S|L] (unique; scope rules checked). */
export const POST = defineRoute(
  { permission: 'marketing:content:write', params: idParams, body: createPlacementBody },
  async ({ db, params, body, user, requestId }) =>
    created(await createPlacement(db, user, params.id, body, requestId)),
);
