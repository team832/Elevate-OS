import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { requestCorrectionBody } from '../../../../../../server/schemas-teaching';
import { requestClassCorrection } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/class-records/:id/request-correction — Send a log back to its teacher as a new draft; the original is kept as superseded. */
export const POST = defineRoute({ permission: 'academic:classes:verify', params: uuidParams, body: requestCorrectionBody }, async (ctx) => created(await requestClassCorrection(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
