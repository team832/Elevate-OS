import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { checkTimetableBody } from '../../../../../server/schemas';
import { checkTimetableFor } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/timetable/check — Conflict check for a date range and optional candidate sessions (read-only). */
export const POST = defineRoute({ permission: 'academic:timetable:read', body: checkTimetableBody }, async (ctx) => checkTimetableFor(ctx.db, actorOf(ctx), ctx.body));
