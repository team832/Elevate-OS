import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../../server/schemas';
import { markRemainingPresent } from '../../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/attendance/mark-remaining — Explicit bulk action: unrecorded placed students and demo attendees become present (audited). */
export const POST = defineRoute({ permission: 'academic:attendance:record', params: uuidParams }, async (ctx) => markRemainingPresent(ctx.db, actorOf(ctx), ctx.params.id));
