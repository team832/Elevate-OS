import { created, defineRoute } from '@elevate/server-kit';
import {
  listFeedbackAboutTeacher,
  recordStudentTeacherFeedback,
} from '../../../../../server/feedback';
import {
  studentTeacherFeedbackBody,
  teacherFeedbackQuery,
} from '../../../../../server/appointments-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/feedback/about-teachers?teacherStaffId= — Student/guardian → teacher feedback. */
export const GET = defineRoute(
  { permission: 'ops:feedback:read', query: teacherFeedbackQuery },
  async ({ user, db, query }) => listFeedbackAboutTeacher(db, user, query.teacherStaffId),
);

/** POST — Staff record a student's or guardian's feedback about a teacher (starts pending). */
export const POST = defineRoute(
  { permission: 'ops:feedback:record', body: studentTeacherFeedbackBody },
  async ({ user, db, body, requestId }) =>
    created(await recordStudentTeacherFeedback(db, user, body, requestId)),
);
