import { created, defineRoute } from '@elevate/server-kit';
import { listMyInterviews, scheduleInterview } from '../../../../../server/hr/recruitment';
import { createInterviewBody } from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/interviews — Interviews the signed-in user sits on. */
export const GET = defineRoute({ permission: 'ops:recruitment:read' }, async ({ user, db }) =>
  listMyInterviews(db, user),
);

/** POST /ops/api/v1/hr/interviews — Schedule an interview with a panel (UTC instant). */
export const POST = defineRoute(
  { permission: 'ops:recruitment:manage', body: createInterviewBody },
  async ({ user, db, body, requestId }) =>
    created(await scheduleInterview(db, user, body, requestId)),
);
