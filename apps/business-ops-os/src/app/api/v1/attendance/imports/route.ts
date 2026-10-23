import { created, defineRoute } from '@elevate/server-kit';
import { previewPunchImport } from '../../../../../server/attendance-import';
import { importPreviewBody } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/imports — Preview a punch CSV (Staff code, Date-time, Direction) row by row; a file already imported → 409. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: importPreviewBody },
  async ({ user, db, body, requestId }) =>
    created(await previewPunchImport(db, user, body, requestId)),
);
