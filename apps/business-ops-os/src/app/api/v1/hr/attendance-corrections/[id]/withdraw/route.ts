import { defineRoute } from '@elevate/server-kit';
import { withdrawCorrection } from '../../../../../../../server/hr/attendance';
import { timeIdParams } from '../../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/attendance-corrections/{id}/withdraw — the requester withdraws a pending correction. */
export const POST = defineRoute(
  { permission: 'ops:attendance:record', params: timeIdParams },
  async ({ user, db, params, requestId }) => withdrawCorrection(db, user, params.id, requestId),
);
