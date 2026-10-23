import { defineRoute } from '@elevate/server-kit';
import { changeUserEmail, emailBody, userIdParams } from '../../../../../../../server/users';

export const dynamic = 'force-dynamic';

/** PUT /api/v1/admin/users/[id]/email — change a person's login email; same account, sessions ended, audited (never your own). */
export const PUT = defineRoute(
  { permission: 'platform:users:manage', params: userIdParams, body: emailBody },
  async ({ db, user, params, body, requestId }) =>
    changeUserEmail(db, user, params.id, body.email, requestId),
);
