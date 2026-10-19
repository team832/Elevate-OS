import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { publishPlacement } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/**
 * POST — publish through the adapter (mock = sandbox, no URL). Idempotent per
 * (placement, version): a repeat returns { duplicate: true } without a second call.
 */
export const POST = defineRoute(
  { permission: 'marketing:content:publish', params: idParams },
  async ({ db, params, user, requestId }) => publishPlacement(db, user, params.id, requestId),
);
