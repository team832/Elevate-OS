import { defineRoute } from '@elevate/server-kit';
import { hrRequestAction } from '../../../../../../server/hr-requests';
import { hrActionBody, hrActionParams } from '../../../../../../server/hr-requests-schemas';

export const dynamic = 'force-dynamic';

/**
 * POST <base>/api/v1/hr-requests/:id/:action — sender: submit; recipient: respond; HR
 * (ops:hr_requests:manage, within its scope): review, forward, resolve, decline, relay, note,
 * create-task. Body `{ body?, hrNote?, toStaffId?, task? }`; 403 for the wrong person, 409 when
 * not possible in the request's state.
 */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:hr_requests:create', 'ops:hr_requests:manage'] },
    params: hrActionParams,
    body: hrActionBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    hrRequestAction(db, user, params.id, params.action, body, requestId),
);
