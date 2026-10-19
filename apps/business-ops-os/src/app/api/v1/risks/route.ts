import { created, defineRoute } from '@elevate/server-kit';
import { createRisk, listRisks } from '../../../../server/planning';
import { riskBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/risks — Risks, issues and blockers. */
export const GET = defineRoute({ permission: 'ops:risks:read' }, async ({ user, db }) =>
  listRisks(db, user),
);

/** POST /ops/api/v1/risks — Record a risk, issue or blocker. */
export const POST = defineRoute(
  { permission: 'ops:risks:write', body: riskBody },
  async ({ user, db, body, requestId }) => created(await createRisk(db, user, body, requestId)),
);
