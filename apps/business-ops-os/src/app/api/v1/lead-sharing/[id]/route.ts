import { defineRoute } from '@elevate/server-kit';
import { deleteSharingRule } from '../../../../../server/lead-sharing';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** DELETE /ops/api/v1/lead-sharing/[id] — Remove a sharing rule. */
export const DELETE = defineRoute(
  { permission: 'ops:leads:assign', params: idParams },
  async ({ user, db, params, requestId }) => deleteSharingRule(db, user, params.id, requestId),
);
