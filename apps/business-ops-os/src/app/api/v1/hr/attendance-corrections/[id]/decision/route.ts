import { defineRoute } from '@elevate/server-kit';
import { decideCorrection } from '../../../../../../../server/hr/attendance';
import { decisionBody, timeIdParams } from '../../../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/attendance-corrections/{id}/decision — approve (supersedes the original) or reject. */
export const POST = defineRoute(
  { permission: 'ops:attendance:approve', params: timeIdParams, body: decisionBody },
  async ({ user, db, params, body, requestId }) =>
    decideCorrection(db, user, params.id, body, requestId),
);
