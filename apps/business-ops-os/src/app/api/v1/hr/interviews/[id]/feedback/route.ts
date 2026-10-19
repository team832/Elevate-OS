import { defineRoute } from '@elevate/server-kit';
import { submitFeedback } from '../../../../../../../server/hr/recruitment';
import { feedbackBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/interviews/{id}/feedback — Feedback by an assigned interviewer only. */
export const POST = defineRoute(
  { permission: 'ops:recruitment:read', params: idParams, body: feedbackBody },
  async ({ user, db, params, body, requestId }) =>
    submitFeedback(db, user, params.id, body, requestId),
);
