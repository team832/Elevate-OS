import { defineRoute } from '@elevate/server-kit';
import { hrProfileBody } from '../../../../../../server/hr-schemas';
import { getHrStaff } from '../../../../../../server/hr-staff';
import { updateHrProfile } from '../../../../../../server/hr-staff-actions';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/staff/[id] — HR staff record; private details only with ops:staff_private:read. */
export const GET = defineRoute(
  { permission: 'ops:hr:read', params: idParams },
  async ({ user, db, params }) => getHrStaff(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/staff/[id] — Edit employment profile fields (audited). */
export const PATCH = defineRoute(
  { permission: 'ops:staff:manage', params: idParams, body: hrProfileBody },
  async ({ user, db, params, body, requestId }) =>
    updateHrProfile(db, user, params.id, body, requestId),
);
