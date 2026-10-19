import { defineRoute } from '@elevate/server-kit';
import { feeActionBody } from '../../../../../server/admissions-schemas';
import { feeRecordAction } from '../../../../../server/fees';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/fees/[id] — `verify` (a different person than the recorder) or `void` (reason required). */
export const POST = defineRoute(
  { permission: 'ops:fees:record', params: idParams, body: feeActionBody },
  async ({ user, db, params, body, requestId }) =>
    feeRecordAction(db, user, params.id, body, requestId),
);
