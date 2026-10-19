import { defineRoute } from '@elevate/server-kit';
import { assignLead } from '../../../../../../server/leads';
import { assignBody, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/assign — Assign the lead owner (handoff pending until accepted). */
export const POST = defineRoute(
  { permission: 'ops:leads:assign', params: idParams, body: assignBody },
  async ({ user, db, params, body, requestId }) =>
    assignLead(db, user, params.id, body.ownerStaffId, requestId),
);
