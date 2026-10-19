import { created, defineRoute } from '@elevate/server-kit';
import { addDependency, removeDependency } from '../../../../../../server/tasks';
import { dependencyBody, dependencyDeleteQuery, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/dependencies — Add a blocked-by dependency (cycles rejected with 409). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: dependencyBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addDependency(db, user, params.id, body.blockedByTaskId, requestId)),
);

/** DELETE /ops/api/v1/tasks/[id]/dependencies — Remove a dependency. */
export const DELETE = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, query: dependencyDeleteQuery },
  async ({ user, db, params, query, requestId }) =>
    removeDependency(db, user, params.id, query.blockedByTaskId, requestId),
);
