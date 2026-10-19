import { defineRoute } from '@elevate/server-kit';
import { updateResponsibility } from '../../../../../server/organisation';
import { idParams, updateResponsibilityBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/responsibilities/[id] — Update holder, backup or status. */
export const PATCH = defineRoute(
  { permission: 'ops:organisation:manage', params: idParams, body: updateResponsibilityBody },
  async ({ user, db, params, body, requestId }) =>
    updateResponsibility(db, user, params.id, body, requestId),
);
