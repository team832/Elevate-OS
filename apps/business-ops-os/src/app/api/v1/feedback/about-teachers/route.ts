import { created, defineRoute } from '@elevate/server-kit';
import {
  listFeedbackAboutTeacher,
  recordStudentTeacherFeedback,
} from '../../../../../server/feedback-responses';
import { teacherFeedbackQuery } from '../../../../../server/appointments-schemas';
import { notFound } from '../../../../../server/context';
import { feedbackScope } from '../../../../../server/feedback-access';
import { feedbackEntryBody } from '../../../../../server/feedback-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/feedback/about-teachers?teacherStaffId= — Raw student/guardian → teacher feedback (HR). */
export const GET = defineRoute(
  { permission: 'ops:teacher_feedback:read', query: teacherFeedbackQuery },
  async ({ user, db, query }) => {
    await feedbackScope(db, user, 'ops:teacher_feedback:read'); // 403 for HR staff who teach
    // null = feedback about the reader: nobody reads raw feedback about themselves.
    return (await listFeedbackAboutTeacher(db, user, query.teacherStaffId)) ?? notFound('Teacher');
  },
);

/** POST — HR records feedback about a teacher (starts pending); `correctsId` hides the row it corrects. */
export const POST = defineRoute(
  { permission: 'ops:teacher_feedback:manage', body: feedbackEntryBody },
  async ({ user, db, body, requestId }) =>
    created(await recordStudentTeacherFeedback(db, user, body, requestId)),
);
