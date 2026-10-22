import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { withdrawReviewBody } from '../../../../../../server/schemas-teaching';
import { withdrawReview } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/reviews/:id/withdraw — Withdraw your submitted review (reason required); Business Ops hides it on its next read. */
export const POST = defineRoute({ permission: 'academic:reviews:write', params: uuidParams, body: withdrawReviewBody }, async (ctx) => withdrawReview(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
