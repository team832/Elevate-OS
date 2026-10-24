import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { buildTimetableBody } from '../../../../../server/schemas-sessions';
import { buildDraftTimetable } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/timetable/build — Build DRAFT weekly patterns for one batch (ACD-029); nothing is published. */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: buildTimetableBody }, async (ctx) => created(await buildDraftTimetable(ctx.db, actorOf(ctx), ctx.body)));
