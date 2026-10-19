import { defineRoute } from '@elevate/server-kit';
import { getPolicy, updatePolicy } from '../../../../../../server/policies-register';
import { idParams } from '../../../../../../server/schemas';
import { updatePolicyBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/settings/policies/[id] — Entry with versions and approval history. */
export const GET = defineRoute(
  { permission: 'ops:settings:read', params: idParams },
  async ({ user, db, params }) => getPolicy(db, user, params.id),
);

/** PATCH /ops/api/v1/settings/policies/[id] — Edit register details (not the requirement text). */
export const PATCH = defineRoute(
  { permission: 'ops:settings:manage', params: idParams, body: updatePolicyBody },
  async ({ user, db, params, body, requestId }) =>
    updatePolicy(db, user, params.id, body, requestId),
);
