import { created, defineRoute } from '@elevate/server-kit';
import { createLeadStage, listLeadStages } from '../../../../server/lead-stages';
import { stageCreateBody } from '../../../../server/lead-stages-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/lead-stages — Lead stages in order, switched-off ones included. */
export const GET = defineRoute({ permission: 'ops:leads:read' }, async ({ user, db }) =>
  listLeadStages(db, user),
);

/** POST /ops/api/v1/lead-stages — Add a stage (marketing or operations manager). */
export const POST = defineRoute(
  { permission: 'ops:leads:assign', body: stageCreateBody },
  async ({ user, db, body, requestId }) =>
    created(await createLeadStage(db, user, body, requestId)),
);
