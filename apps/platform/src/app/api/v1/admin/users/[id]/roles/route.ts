import { defineRoute } from '@elevate/server-kit';
import { rolesBody, setUserRoles, userIdParams } from '../../../../../../../server/users';

export const dynamic = 'force-dynamic';

/** PUT /api/v1/admin/users/[id]/roles — replace the account's roles (never your own). */
export const PUT = defineRoute(
  { permission: 'platform:roles:manage', params: userIdParams, body: rolesBody },
  async ({ db, user, params, body, requestId }) =>
    setUserRoles(db, user, params.id, body.roles, requestId),
);
