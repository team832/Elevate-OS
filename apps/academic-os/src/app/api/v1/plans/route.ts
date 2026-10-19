import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createPlanBody, plansQuery } from '../../../../server/schemas';
import { createPlan, listPlans } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/plans — Plan versions (optionally ?courseId=). */
export const GET = defineRoute({ permission: 'academic:courses:read', query: plansQuery }, async (ctx) => listPlans(ctx.db, { courseId: ctx.query.courseId }));

/** POST /academic/api/v1/plans — Create a proposed plan version (optionally superseding a locked/provisional one). */
export const POST = defineRoute({ permission: 'academic:courses:write', body: createPlanBody }, async (ctx) => created(await createPlan(ctx.db, actorOf(ctx), ctx.body)));
