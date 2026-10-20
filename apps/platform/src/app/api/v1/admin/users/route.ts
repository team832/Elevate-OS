import { created, defineRoute } from '@elevate/server-kit';
import { addPerson, addPersonBody, listUsers, listUsersQuery } from '../../../../../server/users';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/users — accounts with roles; search, filters, sort, 25 per page. */
export const GET = defineRoute(
  { permission: 'platform:users:read', query: listUsersQuery },
  async ({ db, query }) => listUsers(db, query),
);

/** POST /api/v1/admin/users — add a person (@elevateeducation.in only; initial roles need platform:roles:manage). */
export const POST = defineRoute(
  { permission: 'platform:users:manage', body: addPersonBody },
  async ({ db, user, body, requestId }) => created(await addPerson(db, user, body, requestId)),
);
