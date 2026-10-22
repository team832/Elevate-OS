import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { reasonBody } from '../../../../../../server/schemas-sessions';
import { reopenSession } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/reopen — Coordinator correction: a delivered class back to scheduled, with a reason (audited). */
export const POST = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: reasonBody }, async (ctx) => reopenSession(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason));
