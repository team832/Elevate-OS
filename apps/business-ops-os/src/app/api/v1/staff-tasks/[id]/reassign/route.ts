import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { reassignBody } from '../../../../../../server/staff-tasks-schemas';
import { reassignTask } from '../../../../../../server/task-actions';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff-tasks/:id/reassign — Hand the task to a new owner in your scope (history kept). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: reassignBody, idempotency: 'optional' },
  async ({ user, db, params, body, requestId }) =>
    reassignTask(db, user, params.id, body, requestId),
);
