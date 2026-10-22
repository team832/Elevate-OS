import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { reviseReview } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/reviews/:id/revise — Open a draft of the next version of your submitted review. */
export const POST = defineRoute({ permission: 'academic:reviews:write', params: uuidParams }, async (ctx) => created(await reviseReview(ctx.db, actorOf(ctx), ctx.params.id)));
