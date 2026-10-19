import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { requestPlanApprovalBody, uuidParams } from '../../../../../../server/schemas';
import { requestPlanStatusChange } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/plans/:id/approval — Request a core approval to make the plan locked or provisional. */
export const POST = defineRoute({ permission: 'academic:courses:write', params: uuidParams, body: requestPlanApprovalBody }, async (ctx) => created(await requestPlanStatusChange(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)));
