import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { listStudentReviews } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/students/:id/reviews — A student's reviews you may read; `pending` = none submitted yet. */
export const GET = defineRoute({ permission: 'academic:reviews:read', params: uuidParams }, async (ctx) => listStudentReviews(ctx.db, actorOf(ctx), ctx.params.id));
