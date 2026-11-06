import { defineRoute } from '@elevate/server-kit';
import { revokeCover } from '../../../../../../server/approval-cover';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/approval-cover/:id/revoke — the approver, or the cover stepping down, ends it early. */
export const POST = defineRoute(
  { permission: 'ops:module:access', params: idParams },
  async ({ user, db, params, requestId }) => revokeCover(db, user, params.id, requestId),
);
