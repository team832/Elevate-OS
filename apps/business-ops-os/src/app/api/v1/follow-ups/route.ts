import { created, defineRoute } from '@elevate/server-kit';
import { createFollowUp, listFollowUps } from '../../../../server/follow-ups';
import { followUpBody, followUpListQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/follow-ups — Follow-ups (views: mine, overdue, due_today, open, all). */
export const GET = defineRoute(
  { permission: 'ops:leads:read', query: followUpListQuery },
  async ({ user, db, query }) => listFollowUps(db, user, query),
);

/** POST /ops/api/v1/follow-ups — Create a follow-up (owner and due date required). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: followUpBody },
  async ({ user, db, body, requestId }) => created(await createFollowUp(db, user, body, requestId)),
);
