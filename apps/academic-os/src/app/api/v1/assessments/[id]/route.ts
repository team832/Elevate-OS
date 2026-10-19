import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { getAssessment } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assessments/:id — Assessment with sections, key versions, attempt counts and result versions. */
export const GET = defineRoute({ permission: 'academic:assessments:read', params: uuidParams }, async (ctx) => getAssessment(ctx.db, actorOf(ctx), ctx.params.id));
