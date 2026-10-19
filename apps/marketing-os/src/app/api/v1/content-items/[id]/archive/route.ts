import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { archiveBody, archiveContentItem } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — archive (cancel) with a reason; open placements are cancelled. */
export const POST = defineRoute(
  { permission: 'marketing:content:write', params: idParams, body: archiveBody },
  async ({ db, params, body, user, requestId }) =>
    archiveContentItem(db, user, params.id, body.reason, requestId),
);
