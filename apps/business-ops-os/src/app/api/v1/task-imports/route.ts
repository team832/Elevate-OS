import { created, defineRoute } from '@elevate/server-kit';
import { importBody, listImports, previewImport } from '../../../../server/task-import';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/task-imports — Tracker import batches, newest first (no source copy). */
export const GET = defineRoute({ permission: 'ops:tasks:import' }, async ({ user, db }) =>
  listImports(db, user),
);

/** POST /ops/api/v1/task-imports — Upload a tracker backup for one staff member: a dry-run preview (nothing imported yet). */
export const POST = defineRoute(
  { permission: 'ops:tasks:import', body: importBody },
  async ({ user, db, body, requestId }) => created(await previewImport(db, user, body, requestId)),
);
