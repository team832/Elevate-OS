import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { commitImport } from '../../../../../../server/task-import';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/task-imports/:id/commit — Import the accepted records in one transaction (never twice; sends nothing). */
export const POST = defineRoute(
  { permission: 'ops:tasks:import', params: idParams },
  async ({ user, db, params, requestId }) => commitImport(db, user, params.id, requestId),
);
