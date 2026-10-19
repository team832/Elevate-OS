import { defineRoute } from '@elevate/server-kit';
import { updateMitigation } from '../../../../../../../server/planning';
import { mitigationParams, mitigationUpdateBody } from '../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/risks/[id]/mitigations/[mitigationId] — Move a mitigation action on (dropping needs an outcome). */
export const PATCH = defineRoute(
  { permission: 'ops:risks:write', params: mitigationParams, body: mitigationUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateMitigation(db, user, params.id, params.mitigationId, body, requestId),
);
