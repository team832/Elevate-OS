import { defineRoute } from '@elevate/server-kit';
import { setUserStatus, statusBody, userIdParams } from '../../../../../../../server/users';

export const dynamic = 'force-dynamic';

/** PUT /api/v1/admin/users/[id]/status — disable (ends every session) or enable an account (never your own). */
export const PUT = defineRoute(
  { permission: 'platform:users:manage', params: userIdParams, body: statusBody },
  async ({ db, user, params, body, requestId }) =>
    setUserStatus(db, user, params.id, body.status, requestId),
);
