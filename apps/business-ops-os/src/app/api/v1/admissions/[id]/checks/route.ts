import { defineRoute } from '@elevate/server-kit';
import { recordAdmissionCheck } from '../../../../../../server/admissions';
import { checkBody, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/checks — Record a checklist item (status + reference only). */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: checkBody },
  async ({ user, db, params, body, requestId }) =>
    recordAdmissionCheck(db, user, params.id, body, requestId),
);
