import { defineRoute } from '@elevate/server-kit';
import { submitReport } from '../../../../../../server/eod-reports';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/submit — Submit your report to your manager (in-app notification). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams },
  async ({ user, db, params, requestId }) => submitReport(db, user, params.id, requestId),
);
