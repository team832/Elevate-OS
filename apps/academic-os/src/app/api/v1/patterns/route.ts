import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { patternBody, patternsQuery } from '../../../../server/schemas-sessions';
import { createPattern, listPatterns } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/patterns — Timetable patterns (teachers: their own). */
export const GET = defineRoute({ permission: 'academic:timetable:read', query: patternsQuery }, async (ctx) => listPatterns(ctx.db, actorOf(ctx), ctx.query));

/** POST /academic/api/v1/patterns — Create a draft weekly pattern. */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: patternBody }, async (ctx) => created(await createPattern(ctx.db, actorOf(ctx), ctx.body)));
