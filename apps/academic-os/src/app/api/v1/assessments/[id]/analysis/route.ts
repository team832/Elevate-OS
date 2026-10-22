import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { getAssessmentAnalysis } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assessments/:id/analysis — Scored-only average, sections and comparable trend. */
export const GET = defineRoute({ permission: 'academic:assessments:read', params: uuidParams }, async (ctx) => getAssessmentAnalysis(ctx.db, actorOf(ctx), ctx.params.id));
