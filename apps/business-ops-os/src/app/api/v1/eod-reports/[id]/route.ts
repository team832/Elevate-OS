import { defineRoute } from '@elevate/server-kit';
import { getReport } from '../../../../../server/eod-reports';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports/:id — A report (yours, addressed to you, or any with all scope). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => getReport(db, user, params.id),
);
