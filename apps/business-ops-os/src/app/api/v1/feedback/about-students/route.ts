import { defineRoute } from '@elevate/server-kit';
import { listStudentFeedback } from '../../../../../server/feedback';
import { studentFeedbackQuery } from '../../../../../server/appointments-schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/feedback/about-students?studentId= — reviews recorded in Business Ops before
 * 21 Oct 2026 (read-only history; teachers now write reviews in Academic OS).
 */
export const GET = defineRoute(
  { permission: 'ops:feedback:read', query: studentFeedbackQuery },
  async ({ user, db, query }) => listStudentFeedback(db, user, query.studentId),
);
