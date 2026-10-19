import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { updateInterventionBody, uuidParams } from '../../../../../server/schemas';
import { updateIntervention } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PATCH /academic/api/v1/interventions/:id — Update status, outcome or parent-contact status. */
export const PATCH = defineRoute({ permission: 'academic:progress:write', params: uuidParams, body: updateInterventionBody }, async (ctx) => updateIntervention(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
