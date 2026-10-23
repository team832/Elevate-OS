import { defineRoute } from '@elevate/server-kit';
import { commitPunchImport } from '../../../../../../server/attendance-import';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/imports/:id — Commit a previewed import; punches already stored are skipped. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams },
  async ({ user, db, params, requestId }) => commitPunchImport(db, user, params.id, requestId),
);
