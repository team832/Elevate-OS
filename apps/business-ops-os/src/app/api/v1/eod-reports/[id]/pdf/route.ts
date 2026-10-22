import { defineRoute } from '@elevate/server-kit';
import { eodReportPdf } from '../../../../../../server/eod-export';
import { eodVersionQuery } from '../../../../../../server/eod-schemas';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports/:id/pdf?version= — A version (default: latest submitted; else the draft) as a PDF. Audited. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams, query: eodVersionQuery },
  async ({ user, db, params, query }) => {
    const pdf = await eodReportPdf(db, user, params.id, query.version);
    return pdfResponse(pdf.bytes, pdf.filename);
  },
);
