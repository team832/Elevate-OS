import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { reasonBody } from '../../../../../server/schemas-sessions';
import { removeDemoAttendee } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** DELETE /academic/api/v1/demo-attendees/:id — Remove a demo student added by mistake (only before a mark is recorded). */
export const DELETE = defineRoute({ permission: 'academic:attendance:record', params: uuidParams, body: reasonBody }, async (ctx) => removeDemoAttendee(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason));
