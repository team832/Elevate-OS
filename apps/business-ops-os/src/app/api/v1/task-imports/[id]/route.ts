import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../server/schemas';
import { getImport } from '../../../../../server/task-import';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/task-imports/:id — A batch with each record's outcome (dry run, or the reconciliation once committed). */
export const GET = defineRoute(
  { permission: 'ops:tasks:import', params: idParams },
  async ({ user, db, params }) => getImport(db, user, params.id),
);
