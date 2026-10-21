import { created, defineRoute } from '@elevate/server-kit';
import { createDemo, listDemos } from '../../../../server/demos';
import { createDemoBody, demoListQuery } from '../../../../server/demos-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/demos — Demo students by view (current | upcoming | previous) with filters and counts. */
export const GET = defineRoute(
  { permission: 'ops:leads:read', query: demoListQuery },
  async ({ user, db, query }) => listDemos(db, user, query),
);

/** POST /ops/api/v1/demos — Book a demo of N demo days (setting admissions.demo.day_count), one or more classes each. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', body: createDemoBody },
  async ({ user, db, body, requestId }) => created(await createDemo(db, user, body, requestId)),
);
