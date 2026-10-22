import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { deliverBody } from '../../../../../../server/schemas-sessions';
import { markDelivered } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/sessions/:id/deliver — Mark a class delivered with its actual teachers (R12; teachers: own sessions; never HR). */
export const POST = defineRoute({ permission: 'academic:classes:record', params: uuidParams, body: deliverBody }, async (ctx) => markDelivered(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
