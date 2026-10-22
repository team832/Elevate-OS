import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { publishResults } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/publish — Publish final results (coordinator; separate from finalising). */
export const POST = defineRoute({ permission: 'academic:assessments:publish', params: uuidParams }, async (ctx) => publishResults(ctx.db, actorOf(ctx), ctx.params.id));
