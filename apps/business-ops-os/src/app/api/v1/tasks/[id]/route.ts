import { defineRoute } from '@elevate/server-kit';
import { getTaskDetail, updateTask } from '../../../../../server/tasks';
import { idParams, updateTaskBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/tasks/[id] — Task detail with dependencies and escalations. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => getTaskDetail(db, user, params.id),
);

/** PATCH /ops/api/v1/tasks/[id] — Edit a task. */
export const PATCH = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: updateTaskBody },
  async ({ user, db, params, body, requestId }) => updateTask(db, user, params.id, body, requestId),
);
