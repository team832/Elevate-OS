import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { attendanceBody, uuidParams } from '../../../../../../server/schemas';
import { getSessionAttendance, recordAttendance } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/sessions/:id/attendance — Roster and attendance marks (teachers: own sessions). */
export const GET = defineRoute({ permission: 'academic:attendance:read', params: uuidParams }, async (ctx) => getSessionAttendance(ctx.db, actorOf(ctx), ctx.params.id));

/** PUT /academic/api/v1/sessions/:id/attendance — Record or correct attendance (audited; teachers: own sessions). */
export const PUT = defineRoute({ permission: 'academic:attendance:record', params: uuidParams, body: attendanceBody }, async (ctx) => recordAttendance(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
