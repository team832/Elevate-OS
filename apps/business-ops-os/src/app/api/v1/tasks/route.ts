import { created, defineRoute } from '@elevate/server-kit';
import { createTask, listTasks } from '../../../../server/tasks';
import { createTaskBody, taskListQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/tasks — Tasks (views: mine, overdue, escalated, blocked, open, all). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: taskListQuery },
  async ({ user, db, query }) => listTasks(db, user, query.view),
);

/** POST /ops/api/v1/tasks — Create a task. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: createTaskBody },
  async ({ user, db, body, requestId }) => created(await createTask(db, user, body, requestId)),
);
