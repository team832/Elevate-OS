import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../../server/route-helpers';
import { decidePlanApprovalBody, uuidParams } from '../../../../../../../server/schemas';
import { decidePlanStatusChange } from '../../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/plans/:id/approval/decision — Decide the pending approval (another coordinator; no self-approval). */
export const POST = defineRoute({ permission: 'academic:curriculum:approve', params: uuidParams, body: decidePlanApprovalBody }, async (ctx) => decidePlanStatusChange(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
