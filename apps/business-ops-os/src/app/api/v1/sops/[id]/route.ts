import { defineRoute } from '@elevate/server-kit';
import { getSop, updateSop } from '../../../../../server/sops';
import { idParams, updateSopBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/sops/[id] — SOP detail with versions, checklist and approval history. */
export const GET = defineRoute(
  { permission: 'ops:sops:read', params: idParams },
  async ({ user, db, params }) => getSop(db, user, params.id),
);

/** PATCH /ops/api/v1/sops/[id] — Edit SOP metadata (owner, reviewer, backup...). */
export const PATCH = defineRoute(
  { permission: 'ops:sops:write', params: idParams, body: updateSopBody },
  async ({ user, db, params, body, requestId }) => updateSop(db, user, params.id, body, requestId),
);
