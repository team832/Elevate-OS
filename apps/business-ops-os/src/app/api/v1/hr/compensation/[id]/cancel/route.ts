import { defineRoute } from '@elevate/server-kit';
import { cancelCompensation } from '../../../../../../../server/hr/compensation';
import { cancelCompensationBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/compensation/[id]/cancel — Cancel a draft (reason required). */
export const POST = defineRoute(
  { permission: 'ops:compensation:manage', params: staffIdParams, body: cancelCompensationBody },
  async ({ user, db, params, body, requestId }) =>
    cancelCompensation(db, user, params.id, body.reason, requestId),
);
