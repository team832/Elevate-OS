import { created, defineRoute } from '@elevate/server-kit';
import { createTask, listTasks } from '../../../../server/staff-tasks';
import { taskBody, taskListQuery } from '../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff-tasks — Tasks you may read (own scope: yours and your reports'), filtered by staff, department, status, priority, due and acknowledgement. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: taskListQuery },
  async ({ user, db, query }) => listTasks(db, user, query),
);

/** POST /ops/api/v1/staff-tasks — Log a task for yourself or a report (all scope: anyone). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: taskBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await createTask(db, user, body, requestId)),
);
