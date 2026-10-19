import { defineRoute } from '@elevate/server-kit';
import { getShiftTemplate, updateShiftTemplate } from '../../../../../../server/hr/shifts';
import { timeIdParams, updateShiftBody } from '../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/shifts/{id} */
export const GET = defineRoute(
  { permission: 'ops:shifts:read', params: timeIdParams },
  async ({ user, db, params }) => getShiftTemplate(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/shifts/{id} — edit, approve, retire (changed approved timings revert to proposed). */
export const PATCH = defineRoute(
  { permission: 'ops:shifts:manage', params: timeIdParams, body: updateShiftBody },
  async ({ user, db, params, body, requestId }) =>
    updateShiftTemplate(db, user, params.id, body, requestId),
);
