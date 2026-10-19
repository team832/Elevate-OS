import { defineRoute } from '@elevate/server-kit';
import { runMissingClockOutCheck } from '../../../../../../server/hr/attendance';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/hr/attendance/missing-clock-out-check — run the missing
 * clock-out check now (no scheduler yet). Idempotent. Same job as
 * `attendance-missing-clock-out` once the shared jobs route lists it.
 */
export const POST = defineRoute({ permission: 'ops:jobs:run' }, async ({ user, db, requestId }) =>
  runMissingClockOutCheck(db, new Date(), { actor: user, requestId }),
);
