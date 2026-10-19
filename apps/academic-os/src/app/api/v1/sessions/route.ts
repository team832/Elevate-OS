import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createSessionsBody, timetableQuery } from '../../../../server/schemas';
import { createSessions, listSessions } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/sessions — Timetabled sessions (teachers: sessions they teach). */
export const GET = defineRoute({ permission: 'academic:timetable:read', query: timetableQuery }, async (ctx) => listSessions(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/sessions — Schedule sessions; 409 with conflicts when any hard constraint fails. */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: createSessionsBody }, async (ctx) => created(await createSessions(ctx.db, actorOf(ctx), ctx.body.sessions)));
