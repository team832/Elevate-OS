import { created, defineRoute } from '@elevate/server-kit';
import { createAckRequirement, sopAcknowledgementReport } from '../../../../../../server/sops';
import { idParams } from '../../../../../../server/schemas';
import { ackRequirementBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/sops/[id]/acknowledgement-requirements — Requirements and outstanding acknowledgements. */
export const GET = defineRoute(
  { permission: 'ops:sops:read', params: idParams },
  async ({ user, db, params }) => sopAcknowledgementReport(db, user, params.id),
);

/** POST /ops/api/v1/sops/[id]/acknowledgement-requirements — Require acknowledgement by a department or role. */
export const POST = defineRoute(
  { permission: 'ops:sops:write', params: idParams, body: ackRequirementBody },
  async ({ user, db, params, body, requestId }) =>
    created(await createAckRequirement(db, user, params.id, body, requestId)),
);
