import { defineRoute } from '@elevate/server-kit';
import { shareReport } from '../../../../../../server/eod-reports';
import { idParams } from '../../../../../../server/schemas';
import { eodShareBody } from '../../../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/share — WhatsApp or email share; no provider is connected, so it is simulated. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: eodShareBody },
  async ({ user, db, params, body, requestId }) =>
    shareReport(db, user, params.id, body.channel, requestId),
);
