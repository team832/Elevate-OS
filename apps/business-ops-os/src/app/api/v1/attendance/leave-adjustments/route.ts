import { created, defineRoute } from '@elevate/server-kit';
import { adjustmentBody } from '../../../../../server/attendance-schemas';
import { addLeaveAdjustment } from '../../../../../server/leave-balances';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave-adjustments — Carry leave forward (once a year, within the cap and what was left) or adjust a balance, with a reason; needs an allowance; never yourself; audited. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: adjustmentBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await addLeaveAdjustment(db, user, body, requestId)),
);
