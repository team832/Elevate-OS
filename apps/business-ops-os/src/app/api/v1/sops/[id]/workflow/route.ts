import { defineRoute } from '@elevate/server-kit';
import { sopWorkflow } from '../../../../../../server/sops';
import { idParams, sopWorkflowBody } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/sops/[id]/workflow — submit | review | withdraw | approve | reject | retire (each action re-checks its own permission). */
export const POST = defineRoute(
  { permission: 'ops:sops:read', params: idParams, body: sopWorkflowBody },
  async ({ user, db, params, body, requestId }) =>
    sopWorkflow(db, user, params.id, body, requestId),
);
