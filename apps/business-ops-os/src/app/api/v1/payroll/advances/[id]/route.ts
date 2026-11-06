import { defineRoute } from '@elevate/server-kit';
import { cancelAdvance } from '../../../../../../server/payroll';
import { reasonBody } from '../../../../../../server/payroll-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/advances/:id — cancel an advance (reason); no further recovery. */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', params: idParams, body: reasonBody },
  ({ db, user, params, body, requestId }) =>
    cancelAdvance(db, user, params.id, body.reason, requestId),
);
