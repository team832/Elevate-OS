import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { demoAttendeeBody, demoCandidatesQuery } from '../../../../server/schemas-sessions';
import { addDemoAttendee, demoCandidates } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/demo-attendees?sessionId — Business Ops demo students on the class date not yet on the roster ("unavailable" when Ops cannot be reached). */
export const GET = defineRoute({ permission: 'academic:attendance:record', query: demoCandidatesQuery }, async (ctx) => demoCandidates(ctx.db, actorOf(ctx), ctx.query.sessionId));

/** POST /academic/api/v1/demo-attendees — Add an Ops demo student to a class (coordinator or the session's teacher). */
export const POST = defineRoute({ permission: 'academic:attendance:record', body: demoAttendeeBody }, async (ctx) => created(await addDemoAttendee(ctx.db, actorOf(ctx), ctx.body)));
