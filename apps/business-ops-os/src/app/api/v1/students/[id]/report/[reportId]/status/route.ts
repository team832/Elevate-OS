import { defineRoute } from '@elevate/server-kit';
import { reportStatusBody } from '../../../../../../../../server/report-schemas';
import { setStudentReportStatus } from '../../../../../../../../server/student-report';
import { reportParams } from '../params';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/report/[reportId]/status — draft → reviewed (another person) → final. */
export const POST = defineRoute(
  { permission: 'ops:student_reports:generate', params: reportParams, body: reportStatusBody },
  async ({ user, db, params, body, requestId }) =>
    setStudentReportStatus(db, user, params.id, params.reportId, body.to, requestId),
);
