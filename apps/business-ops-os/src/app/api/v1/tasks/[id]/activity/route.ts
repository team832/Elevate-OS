import { defineRoute } from '@elevate/server-kit';
import { getTaskActivity } from '../../../../../../server/tasks';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/tasks/[id]/activity — Unified activity history from the audit log, newest first. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params }) => getTaskActivity(db, user, params.id),
);
