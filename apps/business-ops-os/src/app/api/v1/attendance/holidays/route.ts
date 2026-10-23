import { created, defineRoute } from '@elevate/server-kit';
import { addHoliday } from '../../../../../server/attendance-actions';
import { holidayBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/holidays — HR adds a staff holiday (one branch or all); Proposed until the owner approves the list. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: holidayBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await addHoliday(db, user, body, requestId)),
);
