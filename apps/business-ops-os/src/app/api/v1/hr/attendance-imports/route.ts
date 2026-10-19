import { defineRoute } from '@elevate/server-kit';
import {
  importAttendanceCsv,
  listAttendanceImports,
} from '../../../../../server/hr/attendance-import';
import { importBody, importListQuery } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance-imports — committed import batches. */
export const GET = defineRoute(
  { permission: 'ops:attendance:manage', query: importListQuery },
  async ({ user, db, query }) => listAttendanceImports(db, user, query.page),
);

/** POST /ops/api/v1/hr/attendance-imports — preview (commit=false) or commit a CSV; idempotent per file. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: importBody },
  async ({ user, db, body, requestId }) => importAttendanceCsv(db, user, body, requestId),
);
