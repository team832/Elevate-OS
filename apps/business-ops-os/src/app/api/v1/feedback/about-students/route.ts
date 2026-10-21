import { created, defineRoute } from '@elevate/server-kit';
import { createTeacherFeedback, listStudentFeedback } from '../../../../../server/feedback';
import { studentFeedbackQuery } from '../../../../../server/appointments-schemas';
import { teacherFeedbackBody } from '../../../../../server/report-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/feedback/about-students?studentId= — Teacher → student feedback (all versions). */
export const GET = defineRoute(
  { permission: 'ops:feedback:read', query: studentFeedbackQuery },
  async ({ user, db, query }) => listStudentFeedback(db, user, query.studentId),
);

/** POST — A teacher writes feedback about a student (or a manager on their behalf). */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:feedback:write', 'ops:feedback:manage'] },
    body: teacherFeedbackBody,
  },
  async ({ user, db, body, requestId }) =>
    created(await createTeacherFeedback(db, user, body, requestId)),
);
