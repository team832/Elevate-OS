import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { updateReviewBody } from '../../../../../server/schemas-teaching';
import { getReview, updateReview } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/reviews/:id — One review with its visible version history. */
export const GET = defineRoute({ permission: 'academic:reviews:read', params: uuidParams }, async (ctx) => getReview(ctx.db, actorOf(ctx), ctx.params.id));

/** PATCH /academic/api/v1/reviews/:id — The author edits (and may submit) their draft. Submitted versions are never edited. */
export const PATCH = defineRoute({ permission: 'academic:reviews:write', params: uuidParams, body: updateReviewBody }, async (ctx) => updateReview(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
