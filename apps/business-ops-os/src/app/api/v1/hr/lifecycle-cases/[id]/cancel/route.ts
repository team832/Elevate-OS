import { defineRoute } from '@elevate/server-kit';
import { cancelLifecycleCase } from '../../../../../../../server/hr/offboarding';
import { cancelCaseBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/lifecycle-cases/{id}/cancel — Cancel an open case or retract an approved separation. */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:manage', params: idParams, body: cancelCaseBody },
  async ({ user, db, params, body, requestId }) =>
    cancelLifecycleCase(db, user, params.id, body.reason, requestId),
);
