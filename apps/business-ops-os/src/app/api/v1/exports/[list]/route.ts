import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { EXPORT_LISTS, EXPORT_PERMISSIONS, exportList } from '../../../../../server/list-exports';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/exports/:list?<the page's filters> — every matching row of a list (students,
 * leads, collections, outstanding, staff, tasks) or the month's staff attendance register
 * (`attendance?month=YYYY-MM[&mine=1]`) as CSV. Each list checks its page's permission and scope
 * in the service. Audited.
 */
export const GET = defineRoute(
  {
    permission: { anyOf: EXPORT_PERMISSIONS },
    params: z.object({ list: z.enum(EXPORT_LISTS) }),
    query: z.record(z.string(), z.string()),
  },
  ({ db, user, params, query }) => exportList(db, user, params.list, query),
);
