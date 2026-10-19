import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { planItemsBody, uuidParams } from '../../../../../../server/schemas';
import { addPlanItems } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/plans/:id/items — Add lesson items (proposed plans only). */
export const POST = defineRoute({ permission: 'academic:courses:write', params: uuidParams, body: planItemsBody }, async (ctx) => created(await addPlanItems(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
