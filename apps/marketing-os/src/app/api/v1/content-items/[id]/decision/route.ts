import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { decideContent, decisionBody } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/**
 * POST — approve or request changes. 403 without marketing:content:approve or for the
 * requester/author; 409 INVALID_STATE_TRANSITION when brand rules block; 400 when checklist
 * items are not acknowledged.
 */
export const POST = defineRoute(
  { permission: 'marketing:content:approve', params: idParams, body: decisionBody },
  async ({ db, params, body, user, requestId }) =>
    decideContent(db, user, params.id, body, requestId),
);
