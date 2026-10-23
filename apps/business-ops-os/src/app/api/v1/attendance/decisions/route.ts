import { defineRoute } from '@elevate/server-kit';
import { decideDay } from '../../../../../server/attendance-actions';
import { decisionBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/decisions — HR sets a day's status with a note; it stays over every recomputation. Never your own day. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: decisionBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => decideDay(db, user, body, requestId),
);
