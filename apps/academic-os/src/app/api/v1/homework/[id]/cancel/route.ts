import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { cancelHomeworkBody } from '../../../../../../server/schemas-homework';
import { cancelHomework } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/homework/:id/cancel — Cancel homework with a reason (kept, never deleted; marks can no longer change). */
export const POST = defineRoute({ permission: 'academic:classes:record', params: uuidParams, body: cancelHomeworkBody }, async (ctx) => cancelHomework(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
