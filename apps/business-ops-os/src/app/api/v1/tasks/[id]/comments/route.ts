import { created, defineRoute } from '@elevate/server-kit';
import { addTaskComment, getTaskComments } from '../../../../../../server/tasks';
import { idParams } from '../../../../../../server/schemas';
import { taskCommentBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/tasks/[id]/comments — Comments, oldest first (hidden bodies only for all-scope readers). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => getTaskComments(db, user, params.id),
);

/** POST /ops/api/v1/tasks/[id]/comments — Add an append-only comment (owner/accountable/backup or manager). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskCommentBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addTaskComment(db, user, params.id, body, requestId)),
);
