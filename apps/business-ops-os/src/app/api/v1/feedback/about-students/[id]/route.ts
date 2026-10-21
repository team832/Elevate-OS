import { defineRoute } from '@elevate/server-kit';
import { updateTeacherFeedback } from '../../../../../../server/feedback';
import { teacherFeedbackUpdateBody } from '../../../../../../server/report-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH — Edit a draft in place; editing a final row creates a new version. */
export const PATCH = defineRoute(
  {
    permission: { anyOf: ['ops:feedback:write', 'ops:feedback:manage'] },
    params: idParams,
    body: teacherFeedbackUpdateBody,
  },
  async ({ user, db, params, body, requestId }) =>
    updateTeacherFeedback(db, user, params.id, body, requestId),
);
