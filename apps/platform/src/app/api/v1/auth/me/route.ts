import { modulesFor, permissionsFor } from '@elevate/authorization';
import { defineRoute } from '@elevate/server-kit';

/** GET /api/v1/auth/me — the signed-in user, their modules and permissions. */
export const GET = defineRoute(
  { permission: 'authenticated', module: 'platform' },
  async ({ user }) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    modules: modulesFor(user),
    permissions: Object.fromEntries(permissionsFor(user)),
  }),
);
