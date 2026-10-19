import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { rescheduleSessionBody, uuidParams } from '../../../../../../server/schemas';
import { rescheduleSession } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/reschedule — Reschedule: original kept as rescheduled, linked replacement created. */
export const POST = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: rescheduleSessionBody }, async (ctx) => created(await rescheduleSession(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
