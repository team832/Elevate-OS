import { created, defineRoute } from '@elevate/server-kit';
import { feeRecordAction, feeRecordActionBody } from '../../../../../server/fees';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/fees/[id] — `verify` (a different person than the recorder), `void` (legacy
 * admission rows, reason required), `refund` (a payment; linked row) or `reverse` (linked row with a reason).
 */
export const POST = defineRoute(
  {
    permission: 'ops:fees:record',
    params: idParams,
    body: feeRecordActionBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) => {
    const result = await feeRecordAction(db, user, params.id, body, requestId);
    return body.action === 'refund' || body.action === 'reverse' ? created(result) : result;
  },
);
