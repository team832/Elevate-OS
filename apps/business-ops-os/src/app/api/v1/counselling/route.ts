import { created, defineRoute } from '@elevate/server-kit';
import { scheduleCounselling } from '../../../../server/schedule';
import { counsellingBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/counselling — Book a counselling appointment. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: counsellingBody },
  async ({ user, db, body, requestId }) =>
    created(await scheduleCounselling(db, user, body, requestId)),
);
