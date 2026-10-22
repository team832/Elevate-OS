import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { pdfResponse } from '../../../../../../../../server/pdf/document';
import { teacherReportPdf } from '../../../../../../../../server/teacher-report';

export const dynamic = 'force-dynamic';

/** A report is addressed by its TR- reference or its export id, always under its teacher. */
const reportParams = z.object({
  id: z.uuid(),
  reportId: z.union([z.uuid(), z.string().regex(/^TR-[0-9A-Z]{10}$/)]),
});

/** GET /ops/api/v1/teachers/[id]/report/[reportId]/pdf — The stored report as a PDF (audited). */
export const GET = defineRoute(
  { permission: 'ops:teacher_reports:generate', params: reportParams },
  async ({ user, db, params, requestId }) => {
    const pdf = await teacherReportPdf(db, user, params.id, params.reportId, requestId);
    return pdfResponse(pdf.bytes, pdf.filename);
  },
);
