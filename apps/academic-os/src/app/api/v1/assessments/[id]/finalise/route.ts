import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { finaliseAssessment } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/finalise — Finalise results (immutable version 1). */
export const POST = defineRoute({ permission: 'academic:assessments:finalise', params: uuidParams }, async (ctx) => created(await finaliseAssessment(ctx.db, actorOf(ctx), ctx.params.id)));
