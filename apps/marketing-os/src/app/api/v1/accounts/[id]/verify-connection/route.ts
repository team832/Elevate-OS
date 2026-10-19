import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { verifyAccountConnection } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — run the adapter verification (mock → `sandbox`; never `connected`). */
export const POST = defineRoute(
  { permission: 'marketing:accounts:manage', params: idParams },
  async ({ db, params, user, requestId }) =>
    verifyAccountConnection(db, user, params.id, requestId),
);
