import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { unavailabilityBody, unavailabilityQuery } from '../../../../server/schemas-sessions';
import { createUnavailability, listUnavailability } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/unavailability — Academic availability records (not HR leave). */
export const GET = defineRoute({ permission: 'academic:assignments:read', query: unavailabilityQuery }, async (ctx) => listUnavailability(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/unavailability — Record unavailability; returns the uncovered future classes (no automatic substitute). */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: unavailabilityBody }, async (ctx) => created(await createUnavailability(ctx.db, actorOf(ctx), ctx.body)));
