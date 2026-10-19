import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { cancelSessionBody, uuidParams } from '../../../../../../server/schemas';
import { cancelSession } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/cancel — Cancel a scheduled session with a reason (teacher notified). */
export const POST = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: cancelSessionBody }, async (ctx) => cancelSession(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason));
