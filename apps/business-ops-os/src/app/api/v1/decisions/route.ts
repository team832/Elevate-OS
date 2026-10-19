import { created, defineRoute } from '@elevate/server-kit';
import { createDecision, listDecisions } from '../../../../server/planning';
import { decisionBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/decisions — Decision log. */
export const GET = defineRoute({ permission: 'ops:decisions:read' }, async ({ user, db }) =>
  listDecisions(db, user),
);

/** POST /ops/api/v1/decisions — Record a decision. */
export const POST = defineRoute(
  { permission: 'ops:decisions:write', body: decisionBody },
  async ({ user, db, body, requestId }) => created(await createDecision(db, user, body, requestId)),
);
