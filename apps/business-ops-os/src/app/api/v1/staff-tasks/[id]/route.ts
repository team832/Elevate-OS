import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../server/schemas';
import { updateTask } from '../../../../../server/staff-tasks';
import { taskPatch } from '../../../../../server/staff-tasks-schemas';
import { taskDetail } from '../../../../../server/task-detail';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff-tasks/:id — One task with its events, updates, dependencies and allowed actions (404 outside your scope). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => taskDetail(db, user, params.id),
);

/** PATCH /ops/api/v1/staff-tasks/:id — Change fields (`expectedVersion` required, 409 when stale). Never the status (400: use the task actions); the brief, deadline and review step of assigned work are the assigner's. */
export const PATCH = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskPatch },
  async ({ user, db, params, body, requestId }) => updateTask(db, user, params.id, body, requestId),
);
