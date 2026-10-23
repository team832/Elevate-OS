import { created, defineRoute } from '@elevate/server-kit';
import { recordPunch } from '../../../../../server/attendance-actions';
import { punchBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/punches — HR enters a check-in or check-out by hand (a duplicate → 409). */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: punchBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await recordPunch(db, user, body, requestId)),
);
