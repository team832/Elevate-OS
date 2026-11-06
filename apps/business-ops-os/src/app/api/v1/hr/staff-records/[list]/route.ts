import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  exportStaffRecords,
  STAFF_RECORD_EXPORTS,
} from '../../../../../../server/hr-staff-records';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/staff-records/:list?<the page's filters> — staff assets or checklists as CSV (F4-09). Audited. */
export const GET = defineRoute(
  {
    permission: 'ops:hr:read',
    params: z.object({ list: z.enum(STAFF_RECORD_EXPORTS) }),
    query: z.record(z.string(), z.string()),
  },
  ({ db, user, params, query }) => exportStaffRecords(db, user, params.list, query),
);
