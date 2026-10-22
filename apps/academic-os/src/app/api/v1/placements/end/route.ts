import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { endEnrolmentBody } from '../../../../../server/schemas-placements';
import { endEnrolment } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/placements/end — Complete or withdraw one enrolment and end its placement (explicit confirmation). */
export const POST = defineRoute({ permission: 'academic:enrolments:decide', body: endEnrolmentBody }, async (ctx) => endEnrolment(ctx.db, actorOf(ctx), ctx.body));
