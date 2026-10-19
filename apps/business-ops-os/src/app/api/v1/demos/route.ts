import { created, defineRoute } from '@elevate/server-kit';
import { bookDemo } from '../../../../server/schedule';
import { demoBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/demos — Book a demo (terms/fee from settings). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: demoBody },
  async ({ user, db, body, requestId }) => created(await bookDemo(db, user, body, requestId)),
);
