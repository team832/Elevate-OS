import { defineRoute } from '@elevate/server-kit';
import { acceptLead } from '../../../../../../server/leads';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/accept — The assigned owner accepts the handoff. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams },
  async ({ user, db, params, requestId }) => acceptLead(db, user, params.id, requestId),
);
