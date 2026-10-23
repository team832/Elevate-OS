import { defineRoute } from '@elevate/server-kit';
import { privateDetailsBody } from '../../../../../../../server/hr-schemas';
import { updatePrivateDetails } from '../../../../../../../server/hr-staff-actions';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/hr/staff/[id]/private — Edit HR-private contact details (HR managers only). */
export const PUT = defineRoute(
  { permission: 'ops:staff_private:manage', params: idParams, body: privateDetailsBody },
  async ({ user, db, params, body, requestId }) =>
    updatePrivateDetails(db, user, params.id, body, requestId),
);
