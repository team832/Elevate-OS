import { defineRoute } from '@elevate/server-kit';
import { csvResponse } from '../../../../server/eod-export';
import { periodReportQuery } from '../../../../server/eod-schemas';
import { pdfResponse } from '../../../../server/pdf/document';
import {
  periodReport,
  periodReportCsv,
  periodReportPdf,
} from '../../../../server/task-period-report';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/task-reports?from=&to=&staffId=&departmentId=&format=json|csv|pdf — Team / period task and EOD report (your scope). Downloads are audited. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: periodReportQuery },
  async ({ user, db, query: { format, ...q } }) => {
    if (format === 'csv') {
      const out = await periodReportCsv(db, user, q);
      return csvResponse(out.csv, out.filename);
    }
    if (format === 'pdf') {
      const out = await periodReportPdf(db, user, q);
      return pdfResponse(out.bytes, out.filename);
    }
    return periodReport(db, user, q);
  },
);
