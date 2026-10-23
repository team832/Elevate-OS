import { defineRoute } from '@elevate/server-kit';
import { actionPatchBody } from '../../../../../../server/feedback-schemas';
import { updateAction } from '../../../../../../server/feedback-summaries';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/feedback/actions/:id — Mark done, dropped or open again; record agreement. */
export const PATCH = defineRoute(
  { permission: 'ops:teacher_feedback:manage', params: idParams, body: actionPatchBody },
  async ({ user, db, params, body, requestId }) =>
    updateAction(db, user, params.id, body, requestId),
);
