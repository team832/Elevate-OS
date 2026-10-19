import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { assessmentsQuery, createAssessmentBody } from '../../../../server/schemas';
import { createAssessment, listAssessments } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assessments — Assessments (teachers: own batches). */
export const GET = defineRoute({ permission: 'academic:assessments:read', query: assessmentsQuery }, async (ctx) => listAssessments(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/assessments — Create an assessment with an optional scoring rule and sections. */
export const POST = defineRoute({ permission: 'academic:assessments:write', body: createAssessmentBody }, async (ctx) => created(await createAssessment(ctx.db, actorOf(ctx), ctx.body)));
