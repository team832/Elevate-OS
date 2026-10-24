import { defineRoute } from '@elevate/server-kit';
import { changeLeadStage } from '../../../../../../server/lead-stages';
import { stageChangeBody } from '../../../../../../server/lead-stages-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/stage — Move the lead to a stage (reason when the stage needs one; Converted only after Ops confirms the admission). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: stageChangeBody },
  async ({ user, db, params, body, requestId }) =>
    changeLeadStage(db, user, params.id, body, requestId),
);
