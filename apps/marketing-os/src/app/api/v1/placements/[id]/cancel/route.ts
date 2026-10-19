import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { cancelBody, cancelPlacement } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — cancel with a reason (planned: content:write; scheduled: schedule:manage — checked in the service). */
export const POST = defineRoute(
  {
    permission: { anyOf: ['marketing:content:write', 'marketing:schedule:manage'] },
    params: idParams,
    body: cancelBody,
  },
  async ({ db, params, body, user, requestId }) =>
    cancelPlacement(db, user, params.id, body.reason, requestId),
);
