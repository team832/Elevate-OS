import { defineRoute } from '@elevate/server-kit';
import { eodReportPdf } from '../../../../../../server/eod-reports';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports/:id/pdf — The report as a PDF (same read rules as the screen). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => {
    const pdf = await eodReportPdf(db, user, params.id);
    return pdfResponse(pdf.bytes, pdf.filename);
  },
);
