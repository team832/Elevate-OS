import { defineRoute } from '@elevate/server-kit';
import { moderateStudentTeacherFeedback } from '../../../../../../server/feedback';
import { moderationBody } from '../../../../../../server/appointments-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH — Moderate (approve | reject | hide). The only change allowed; the teacher cannot make it. */
export const PATCH = defineRoute(
  { permission: 'ops:feedback:moderate', params: idParams, body: moderationBody },
  async ({ user, db, params, body, requestId }) =>
    moderateStudentTeacherFeedback(db, user, params.id, body, requestId),
);
