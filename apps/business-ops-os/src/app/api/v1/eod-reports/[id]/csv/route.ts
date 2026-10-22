import { defineRoute } from '@elevate/server-kit';
import { csvResponse, eodReportCsv } from '../../../../../../server/eod-export';
import { eodVersionQuery } from '../../../../../../server/eod-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports/:id/csv?version= — The report's facts as CSV. Audited. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams, query: eodVersionQuery },
  async ({ user, db, params, query }) => {
    const out = await eodReportCsv(db, user, params.id, query.version);
    return csvResponse(out.csv, out.filename);
  },
);
