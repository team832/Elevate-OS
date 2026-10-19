import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createInterventionBody, interventionsQuery } from '../../../../server/schemas';
import { createIntervention, listInterventions } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/interventions — Interventions (teachers: students of their batches). */
export const GET = defineRoute({ permission: 'academic:progress:read', query: interventionsQuery }, async (ctx) => listInterventions(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/interventions — Open an intervention with a responsible staff member. */
export const POST = defineRoute({ permission: 'academic:progress:write', body: createInterventionBody }, async (ctx) => created(await createIntervention(ctx.db, actorOf(ctx), ctx.body)));
