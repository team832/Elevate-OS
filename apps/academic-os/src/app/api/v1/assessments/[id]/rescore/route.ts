import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { rescoreBody, uuidParams } from '../../../../../../server/schemas';
import { rescoreAssessment } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/rescore — Re-score into a new result version (previous kept, audited). */
export const POST = defineRoute({ permission: 'academic:assessments:finalise', params: uuidParams, body: rescoreBody }, async (ctx) => created(await rescoreAssessment(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason)));
