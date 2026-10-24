import { defineRoute } from '@elevate/server-kit';
import {
  draftTeacherReportComment,
  teacherReportDraftBody,
} from '../../../../../server/ai-report-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/teacher-report — AI draft of a teacher report's overall comment from its facts (nothing saved; D-111). */
export const POST = defineRoute(
  { permission: 'ops:teacher_reports:generate', body: teacherReportDraftBody, maxBodyBytes: 4096 },
  async ({ user, db, body, requestId }) => ({
    items: await draftTeacherReportComment(db, user, body, requestId),
  }),
);
