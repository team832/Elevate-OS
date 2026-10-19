import { created, defineRoute } from '@elevate/server-kit';
import { feeRecordBody } from '../../../../../../server/admissions-schemas';
import { listAdmissionFees, recordFee } from '../../../../../../server/fees';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions/[id]/fees — Manually recorded fee records, summary and disclaimer (not verified transactions). */
export const GET = defineRoute(
  { permission: 'ops:fees:read', params: idParams },
  async ({ user, db, params }) => listAdmissionFees(db, user, params.id),
);

/** POST /ops/api/v1/admissions/[id]/fees — Record an amount due, received, refunded or adjusted (integer paise, INR). */
export const POST = defineRoute(
  { permission: 'ops:fees:record', params: idParams, body: feeRecordBody, idempotency: 'optional' },
  async ({ user, db, params, body, requestId }) =>
    created(await recordFee(db, user, params.id, body, requestId)),
);
