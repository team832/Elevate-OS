import { defineRoute } from '@elevate/server-kit';
import { pdfResponse } from '../../../../../../../../server/pdf/document';
import { studentReportPdf } from '../../../../../../../../server/student-report';
import { reportParams } from '../params';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/[id]/report/[reportId]/pdf — The stored report as a PDF (reader's sections only; audited). */
export const GET = defineRoute(
  { permission: 'ops:student_reports:generate', params: reportParams },
  async ({ user, db, params, requestId }) => {
    const pdf = await studentReportPdf(db, user, params.id, params.reportId, requestId);
    return pdfResponse(pdf.bytes, pdf.filename);
  },
);
