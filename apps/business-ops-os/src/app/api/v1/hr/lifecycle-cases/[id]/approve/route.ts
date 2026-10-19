import { defineRoute } from '@elevate/server-kit';
import { approveLifecycleCase } from '../../../../../../../server/hr/offboarding';
import { confirmBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/lifecycle-cases/{id}/approve — Final approval (never by the employee themself). */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:approve', params: idParams, body: confirmBody },
  async ({ user, db, params, body, requestId }) =>
    approveLifecycleCase(db, user, params.id, body.comment, requestId),
);
