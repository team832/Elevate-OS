import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { resultsQuery, uuidParams } from '../../../../../../server/schemas';
import { getResults } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assessments/:id/results — Results of the final (or ?version=) result version. */
export const GET = defineRoute({ permission: 'academic:assessments:read', params: uuidParams, query: resultsQuery }, async (ctx) => getResults(ctx.db, actorOf(ctx), ctx.params.id, ctx.query.version));
