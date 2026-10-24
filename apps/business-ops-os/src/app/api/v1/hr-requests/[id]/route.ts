import { defineRoute } from '@elevate/server-kit';
import { updateHrRequest } from '../../../../../server/hr-requests';
import { getHrRequest } from '../../../../../server/hr-requests-read';
import { hrRequestPatch } from '../../../../../server/hr-requests-schemas';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/hr-requests/:id — The request as you may see it (sender, HR or recipient); 404 otherwise. */
export const GET = defineRoute(
  { permission: { anyOf: ['ops:hr_requests:create', 'ops:hr_requests:read'] }, params: idParams },
  async ({ user, db, params }) => getHrRequest(db, user, params.id),
);

/** PATCH <base>/api/v1/hr-requests/:id — Change your draft; 409 once it is sent to HR. */
export const PATCH = defineRoute(
  { permission: 'ops:hr_requests:create', params: idParams, body: hrRequestPatch },
  async ({ user, db, params, body, requestId }) =>
    updateHrRequest(db, user, params.id, body, requestId),
);
