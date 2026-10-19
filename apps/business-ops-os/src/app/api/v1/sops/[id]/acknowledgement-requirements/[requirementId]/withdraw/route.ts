import { defineRoute } from '@elevate/server-kit';
import { withdrawAckRequirement } from '../../../../../../../../server/sops';
import {
  requirementParams,
  withdrawRequirementBody,
} from '../../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/sops/[id]/acknowledgement-requirements/[requirementId]/withdraw — Withdraw with a reason. */
export const POST = defineRoute(
  { permission: 'ops:sops:write', params: requirementParams, body: withdrawRequirementBody },
  async ({ user, db, params, body, requestId }) =>
    withdrawAckRequirement(db, user, params.id, params.requirementId, body, requestId),
);
