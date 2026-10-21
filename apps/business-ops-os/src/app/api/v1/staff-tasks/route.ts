import { created, defineRoute } from '@elevate/server-kit';
import { createTask, listTasks } from '../../../../server/staff-tasks';
import { taskBody, taskListQuery } from '../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff-tasks — Tasks you may read (own scope: yours), filtered by staff, status, priority, due days. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: taskListQuery },
  async ({ user, db, query }) => listTasks(db, user, query),
);

/** POST /ops/api/v1/staff-tasks — Log a task (yours; another person's needs all-scope write). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: taskBody },
  async ({ user, db, body, requestId }) => created(await createTask(db, user, body, requestId)),
);
