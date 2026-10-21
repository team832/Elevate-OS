import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../server/schemas';
import { getTask, updateTask } from '../../../../../server/staff-tasks';
import { taskPatch } from '../../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff-tasks/:id — One task (404 outside your scope). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => getTask(db, user, params.id),
);

/** PATCH /ops/api/v1/staff-tasks/:id — Change status, progress, reason or details; done creates the next occurrence once. */
export const PATCH = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskPatch },
  async ({ user, db, params, body, requestId }) => updateTask(db, user, params.id, body, requestId),
);
