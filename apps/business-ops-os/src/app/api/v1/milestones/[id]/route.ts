import { defineRoute } from '@elevate/server-kit';
import { updateMilestone } from '../../../../../server/planning';
import { idParams, milestoneUpdateBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/milestones/[id] — Update milestone status/date or add a dependency. */
export const PATCH = defineRoute(
  { permission: 'ops:risks:write', params: idParams, body: milestoneUpdateBody },
  async ({ user, db, params, body, requestId }) =>
    updateMilestone(db, user, params.id, body, requestId),
);
