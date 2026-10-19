import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { generateCatchupTasks, listCatchup } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/batches/:id/catch-up — Prioritised catch-up list with explained factors. */
export const GET = defineRoute({ permission: 'academic:progress:read', params: uuidParams }, async (ctx) => listCatchup(ctx.db, actorOf(ctx), ctx.params.id));

/** POST /academic/api/v1/batches/:id/catch-up — Generate catch-up tasks for missed classes (idempotent). */
export const POST = defineRoute({ permission: 'academic:progress:write', params: uuidParams }, async (ctx) => generateCatchupTasks(ctx.db, actorOf(ctx), ctx.params.id));
