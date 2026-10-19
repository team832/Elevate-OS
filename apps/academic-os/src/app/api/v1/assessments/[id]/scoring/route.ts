import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { scoringBody, uuidParams } from '../../../../../../server/schemas';
import { configureScoring } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** PUT /academic/api/v1/assessments/:id/scoring — Configure the scoring rule and sections. */
export const PUT = defineRoute({ permission: 'academic:assessments:write', params: uuidParams, body: scoringBody }, async (ctx) => configureScoring(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
