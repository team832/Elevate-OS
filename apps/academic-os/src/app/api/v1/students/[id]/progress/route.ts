import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { getStudentProgress } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/students/:id/progress — Attendance, results, trend, missed classes, catch-up and interventions. */
export const GET = defineRoute({ permission: 'academic:progress:read', params: uuidParams }, async (ctx) => getStudentProgress(ctx.db, actorOf(ctx), ctx.params.id));
