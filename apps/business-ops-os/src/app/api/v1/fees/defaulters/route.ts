import { csvResponse, defineRoute } from '@elevate/server-kit';
import { defaultersCsv, defaultersQuery } from '../../../../../server/fee-defaulters';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/fees/defaulters?programme=&counsellor=&band= — Overdue fees as a spreadsheet (CSV), your scope. Audited. */
export const GET = defineRoute(
  { permission: 'ops:fees:read', query: defaultersQuery },
  async ({ user, db, query }) => {
    const out = await defaultersCsv(db, user, query);
    return csvResponse(out.csv, out.filename);
  },
);
