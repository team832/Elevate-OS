import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createReviewBody, reviewsQuery } from '../../../../server/schemas-teaching';
import { createReview, listReviews } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/reviews?academicStudentId&coreStudentId&status&mine=1 — Teacher reviews (own; others' submitted ones in current scope; drafts only to their author). */
export const GET = defineRoute({ permission: 'academic:reviews:read', query: reviewsQuery }, async (ctx) => listReviews(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/reviews — Save a draft review, or submit it (`submit: true`), for a student currently in your scope. */
export const POST = defineRoute({ permission: 'academic:reviews:write', body: createReviewBody }, async (ctx) => created(await createReview(ctx.db, actorOf(ctx), ctx.body)));
