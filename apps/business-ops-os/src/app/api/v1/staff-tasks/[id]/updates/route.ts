import { created, defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { taskUpdateBody } from '../../../../../../server/staff-tasks-schemas';
import { addTaskUpdate } from '../../../../../../server/task-updates';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff-tasks/:id/updates — Log work (or correct an entry with a reason); returns overlap `warnings`. */
export const POST = defineRoute(
  {
    permission: 'ops:tasks:write',
    params: idParams,
    body: taskUpdateBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await addTaskUpdate(db, user, params.id, body, requestId)),
);
