import { defineRoute } from '@elevate/server-kit';
import { taskActionBody, taskActionParams } from '../../../../../../server/staff-tasks-schemas';
import { taskAction } from '../../../../../../server/task-actions';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/staff-tasks/:id/:action — A lifecycle step: acknowledge, request-clarification,
 * start, block, hold, resume, submit-for-review, approve, request-changes, complete, cancel, reopen.
 * Body `{ expectedVersion, reason? }`; 409 when stale or not possible now; returns `warnings`.
 */
export const POST = defineRoute(
  {
    permission: 'ops:tasks:write',
    params: taskActionParams,
    body: taskActionBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    taskAction(db, user, params.id, params.action, body, requestId),
);
