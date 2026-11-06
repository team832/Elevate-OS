import { created, defineRoute } from '@elevate/server-kit';
import { issuePortalCode } from '../../../../../../server/portal-access';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/portal-access/[id]/code — A new one-time setup code for the slip (the old one
 * stops working). No idempotency: a stored replay would keep the code.
 */
export const POST = defineRoute(
  { permission: 'ops:guardians:write', params: idParams },
  async ({ user, db, params, requestId }) =>
    created(await issuePortalCode(db, user, params.id, requestId)),
);
