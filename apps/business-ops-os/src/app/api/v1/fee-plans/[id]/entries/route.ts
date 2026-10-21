import { created, defineRoute } from '@elevate/server-kit';
import { feePlanEntryBody, recordPlanEntry } from '../../../../../../server/fees';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/fee-plans/[id]/entries — Append a manually recorded ledger row (payment, refund, discount, waiver, adjustment). */
export const POST = defineRoute(
  {
    permission: 'ops:fees:record',
    params: idParams,
    body: feePlanEntryBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await recordPlanEntry(db, user, params.id, body, requestId)),
);
