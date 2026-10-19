import { defineRoute } from '@elevate/server-kit';
import { getCorrection } from '../../../../../../server/hr/attendance';
import { timeIdParams } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance-corrections/{id} */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', params: timeIdParams },
  async ({ user, db, params }) => getCorrection(db, user, params.id),
);
