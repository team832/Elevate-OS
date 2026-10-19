import { defineRoute } from '@elevate/server-kit';
import { setSopSchedule } from '../../../../../../server/sops';
import { idParams } from '../../../../../../server/schemas';
import { sopScheduleBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/sops/[id]/schedule — Effective and next review date of the approved version in force. */
export const PUT = defineRoute(
  { permission: 'ops:sops:write', params: idParams, body: sopScheduleBody },
  async ({ user, db, params, body, requestId }) =>
    setSopSchedule(db, user, params.id, body, requestId),
);
