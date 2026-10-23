import { created, defineRoute } from '@elevate/server-kit';
import { recordLeave } from '../../../../../server/attendance-actions';
import { leaveBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave — HR records approved leave (dates inclusive). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: leaveBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await recordLeave(db, user, body, requestId)),
);
