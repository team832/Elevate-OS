import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createBatchBody } from '../../../../server/schemas';
import { createBatch, listBatches } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/batches — Batches (teachers: assigned batches only). */
export const GET = defineRoute({ permission: 'academic:batches:read' }, async (ctx) => listBatches(ctx.db, actorOf(ctx)));

/** POST /academic/api/v1/batches — Create a batch on a course version. */
export const POST = defineRoute({ permission: 'academic:batches:write', body: createBatchBody }, async (ctx) => created(await createBatch(ctx.db, actorOf(ctx), ctx.body)));
