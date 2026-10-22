import { created, defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { dependencyBody } from '../../../../../../server/staff-tasks-schemas';
import { addDependency } from '../../../../../../server/task-actions';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff-tasks/:id/dependencies — This task waits on another (self and cycles refused). */
export const POST = defineRoute(
  {
    permission: 'ops:tasks:write',
    params: idParams,
    body: dependencyBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await addDependency(db, user, params.id, body, requestId)),
);
