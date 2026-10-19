import { defineRoute } from '@elevate/server-kit';
import { changeTaskStatus } from '../../../../../../server/tasks';
import { idParams, taskStatusBody } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/status — Change task status (completion needs evidence; blockers enforced). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskStatusBody },
  async ({ user, db, params, body, requestId }) =>
    changeTaskStatus(db, user, params.id, body, requestId),
);
