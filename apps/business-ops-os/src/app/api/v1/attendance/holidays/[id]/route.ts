import { defineRoute } from '@elevate/server-kit';
import { decideHoliday } from '../../../../../../server/attendance-actions';
import { holidayDecisionBody } from '../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/holidays/:id — `{ action: 'approve' | 'remove' }`: only an approved holiday changes staff days. */
export const POST = defineRoute(
  { permission: 'ops:hr_settings:manage', params: idParams, body: holidayDecisionBody },
  async ({ user, db, params, body, requestId }) =>
    decideHoliday(db, user, params.id, body.action, requestId),
);
