import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { validateAssessment } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/validate — Validate before finalising (read-only). */
export const POST = defineRoute({ permission: 'academic:assessments:read', params: uuidParams }, async (ctx) => validateAssessment(ctx.db, actorOf(ctx), ctx.params.id));
