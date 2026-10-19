import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { catchupUpdateBody, uuidParams } from '../../../../../server/schemas';
import { updateCatchupTask } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** PATCH /academic/api/v1/catch-up-tasks/:id — Update a catch-up task. */
export const PATCH = defineRoute({ permission: 'academic:progress:write', params: uuidParams, body: catchupUpdateBody }, async (ctx) => updateCatchupTask(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
