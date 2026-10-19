import { defineRoute } from '@elevate/server-kit';
import {
  removeTaskReviewRequirement,
  setTaskReviewRequirement,
} from '../../../../../../server/tasks';
import { idParams } from '../../../../../../server/schemas';
import { reviewRequirementBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/tasks/[id]/review-requirement — Require a supervisor review on completion (operations manager). */
export const PUT = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: reviewRequirementBody },
  async ({ user, db, params, body, requestId }) =>
    setTaskReviewRequirement(db, user, params.id, body, requestId),
);

/** DELETE /ops/api/v1/tasks/[id]/review-requirement — Remove the requirement (no review pending). */
export const DELETE = defineRoute(
  { permission: 'ops:tasks:write', params: idParams },
  async ({ user, db, params, requestId }) =>
    removeTaskReviewRequirement(db, user, params.id, requestId),
);
