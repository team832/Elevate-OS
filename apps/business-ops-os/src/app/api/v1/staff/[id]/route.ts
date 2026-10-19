import { defineRoute } from '@elevate/server-kit';
import { getStaffDetail, updateStaff } from '../../../../../server/organisation';
import { idParams, updateStaffBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff/[id] — Staff detail with onboarding checklist. */
export const GET = defineRoute(
  { permission: 'ops:organisation:read', params: idParams },
  async ({ user, db, params }) => getStaffDetail(db, user, params.id),
);

/** PATCH /ops/api/v1/staff/[id] — Update a staff member (reporting-line loops rejected). */
export const PATCH = defineRoute(
  { permission: 'ops:organisation:manage', params: idParams, body: updateStaffBody },
  async ({ user, db, params, body, requestId }) =>
    updateStaff(db, user, params.id, body, requestId),
);
