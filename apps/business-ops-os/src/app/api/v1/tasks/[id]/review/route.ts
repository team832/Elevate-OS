import { defineRoute } from '@elevate/server-kit';
import { decideTaskReview } from '../../../../../../server/tasks';
import { idParams } from '../../../../../../server/schemas';
import { taskReviewBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/review — Accept or return a completed task (never by the completer or owner). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskReviewBody },
  async ({ user, db, params, body, requestId }) =>
    decideTaskReview(db, user, params.id, body, requestId),
);
