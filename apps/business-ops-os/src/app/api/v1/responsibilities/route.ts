import { created, defineRoute } from '@elevate/server-kit';
import { createResponsibility } from '../../../../server/organisation';
import { responsibilityBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/responsibilities — Create a responsibility. */
export const POST = defineRoute(
  { permission: 'ops:organisation:manage', body: responsibilityBody },
  async ({ user, db, body, requestId }) =>
    created(await createResponsibility(db, user, body, requestId)),
);
