import { created, defineRoute } from '@elevate/server-kit';
import { createTest, listTests } from '../../../../server/assessments';
import { createTestBody, testListQuery } from '../../../../server/assessments-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/assessments?view&courseId&batchId&teacherStaffId&from&to&page: one view, every view's count. */
export const GET = defineRoute(
  { permission: 'ops:assessments:read', query: testListQuery },
  async ({ db, user, query }) => listTests(db, user, query),
);

/** POST /ops/api/v1/assessments: create in Academic (scheduled when dated, then the roster is taken). */
export const POST = defineRoute(
  { permission: 'ops:assessments:manage', body: createTestBody },
  async ({ db, user, body }) => created(await createTest(db, user, body)),
);
