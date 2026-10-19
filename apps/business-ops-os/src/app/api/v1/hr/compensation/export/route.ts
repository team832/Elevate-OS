import { defineRoute } from '@elevate/server-kit';
import { exportCompensation } from '../../../../../../server/hr/compensation';
import { compensationExportQuery } from '../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/hr/compensation/export?asOf=YYYY-MM-DD — CSV of the terms
 * effective on the date, for an authorised payroll process (no payroll is run).
 * Audited with the export reference (header `X-Export-Reference`).
 */
export const GET = defineRoute(
  { permission: 'ops:compensation:export', query: compensationExportQuery },
  async ({ user, db, query, requestId }) => {
    const result = await exportCompensation(db, user, { asOf: query.asOf }, requestId);
    return new Response(result.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="' + result.exportReference + '.csv"',
        'cache-control': 'no-store',
        'x-export-reference': result.exportReference,
        'x-request-id': requestId,
      },
    });
  },
);
