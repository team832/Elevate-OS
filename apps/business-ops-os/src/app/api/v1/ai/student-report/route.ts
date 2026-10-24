import { defineRoute } from '@elevate/server-kit';
import {
  draftStudentReportComment,
  studentReportDraftBody,
} from '../../../../../server/ai-report-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/student-report — AI draft of a progress report's overall comment from its facts (nothing saved; D-111). */
export const POST = defineRoute(
  { permission: 'ops:student_reports:generate', body: studentReportDraftBody, maxBodyBytes: 4096 },
  async ({ user, db, body, requestId }) => ({
    items: await draftStudentReportComment(db, user, body, requestId),
  }),
);
