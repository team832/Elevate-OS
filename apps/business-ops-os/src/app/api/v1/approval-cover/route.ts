import { created, defineRoute } from '@elevate/server-kit';
import { coverBody, createCover, myCovers } from '../../../../server/approval-cover';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/approval-cover — the covers you gave and hold. */
export const GET = defineRoute({ permission: 'ops:module:access' }, async ({ user, db }) =>
  myCovers(db, user),
);

/** POST /ops/api/v1/approval-cover — name a cover for your approvals on these IST dates (F4-10). */
export const POST = defineRoute(
  { permission: 'ops:module:access', body: coverBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await createCover(db, user, body, requestId)),
);
