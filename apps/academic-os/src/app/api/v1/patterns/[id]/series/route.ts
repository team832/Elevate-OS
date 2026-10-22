import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { seriesEditBody } from '../../../../../../server/schemas-sessions';
import { editSeries } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/patterns/:id/series — Change a published series from an effective date; delivered classes are untouched. */
export const POST = defineRoute({ permission: 'academic:timetable:publish', params: uuidParams, body: seriesEditBody }, async (ctx) => editSeries(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
