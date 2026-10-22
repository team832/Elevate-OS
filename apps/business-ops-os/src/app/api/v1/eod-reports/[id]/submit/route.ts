import { defineRoute } from '@elevate/server-kit';
import { submitReport } from '../../../../../../server/eod-reports';
import { eodSubmitBody } from '../../../../../../server/eod-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/submit — Submit your report as a new version to your manager (or a chosen EOD reviewer when none resolves). Repeating it returns the same version. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: eodSubmitBody },
  async ({ user, db, params, body, requestId }) =>
    submitReport(db, user, params.id, body, requestId),
);
