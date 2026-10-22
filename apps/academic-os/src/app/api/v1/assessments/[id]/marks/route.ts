import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { marksBody } from '../../../../../../server/schemas-assessment';
import { enterMarks, getMarksSheet } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assessments/:id/marks — Marks sheet: every eligible student with state, score and version. */
export const GET = defineRoute({ permission: 'academic:assessments:mark', params: uuidParams }, async (ctx) => getMarksSheet(ctx.db, actorOf(ctx), ctx.params.id));

/** PUT /academic/api/v1/assessments/:id/marks — Enter result states and manual totals (version-checked, audited). */
export const PUT = defineRoute({ permission: 'academic:assessments:mark', params: uuidParams, body: marksBody }, async (ctx) => enterMarks(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
