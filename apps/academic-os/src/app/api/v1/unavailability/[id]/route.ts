import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { reasonBody } from '../../../../../server/schemas-sessions';
import { cancelUnavailability } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** DELETE /academic/api/v1/unavailability/:id — Withdraw an availability record with a reason (kept, audited). */
export const DELETE = defineRoute({ permission: 'academic:timetable:write', params: uuidParams, body: reasonBody }, async (ctx) => cancelUnavailability(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.reason));
