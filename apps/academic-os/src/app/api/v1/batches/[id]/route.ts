import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { updateBatchBody, uuidParams } from '../../../../../server/schemas';
import { getBatch, updateBatch } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/batches/:id — Batch with assignments, calendar rules, exclusions and current plan. */
export const GET = defineRoute({ permission: 'academic:batches:read', params: uuidParams }, async (ctx) => getBatch(ctx.db, actorOf(ctx), ctx.params.id));

/** PATCH /academic/api/v1/batches/:id — Update status, capacity or dates. */
export const PATCH = defineRoute({ permission: 'academic:batches:write', params: uuidParams, body: updateBatchBody }, async (ctx) => updateBatch(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
