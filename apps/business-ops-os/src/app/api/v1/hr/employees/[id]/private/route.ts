import { defineRoute } from '@elevate/server-kit';
import { getPrivateRecord, updatePrivateDetails } from '../../../../../../../server/hr/private';
import { privateDetailsBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees/[id]/private — Private HR fields (own = self only). */
export const GET = defineRoute(
  { permission: 'ops:employee_private:read', params: staffIdParams },
  async ({ user, db, params }) => getPrivateRecord(db, user, params.id),
);

/** PUT /ops/api/v1/hr/employees/[id]/private — Update legal name, personal contacts and address. */
export const PUT = defineRoute(
  { permission: 'ops:employee_private:manage', params: staffIdParams, body: privateDetailsBody },
  async ({ user, db, params, body, requestId }) =>
    updatePrivateDetails(db, user, params.id, body, requestId),
);
