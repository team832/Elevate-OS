import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { scheduleCheckBody } from '../../../../../server/schemas';
import { checkAssessmentScheduleFor } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/schedule-check — Assessment scheduling constraints for a batch (read-only). */
export const POST = defineRoute({ permission: 'academic:assessments:read', body: scheduleCheckBody }, async (ctx) => checkAssessmentScheduleFor(ctx.db, actorOf(ctx), ctx.body));
