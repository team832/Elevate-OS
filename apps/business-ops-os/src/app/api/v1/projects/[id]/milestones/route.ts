import { created, defineRoute } from '@elevate/server-kit';
import { addMilestone } from '../../../../../../server/planning';
import { idParams, milestoneBody } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/projects/[id]/milestones — Add a milestone (dependency cycles rejected). */
export const POST = defineRoute(
  { permission: 'ops:risks:write', params: idParams, body: milestoneBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addMilestone(db, user, params.id, body, requestId)),
);
