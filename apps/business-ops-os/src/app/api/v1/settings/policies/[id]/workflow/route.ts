import { defineRoute } from '@elevate/server-kit';
import { policyWorkflow } from '../../../../../../../server/policies-register';
import { idParams } from '../../../../../../../server/schemas';
import { policyWorkflowBody } from '../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/settings/policies/[id]/workflow — propose, approve (not by the proposer), reject, withdraw, retire. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:settings:manage', 'ops:policies:approve'] },
    params: idParams,
    body: policyWorkflowBody,
  },
  async ({ user, db, params, body, requestId }) =>
    policyWorkflow(db, user, params.id, body, requestId),
);
