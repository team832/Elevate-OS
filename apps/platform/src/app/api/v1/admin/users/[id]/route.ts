import { defineRoute } from '@elevate/server-kit';
import { getUserDetail, userIdParams } from '../../../../../../server/users';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/users/[id] — one account, its roles and its audit history. */
export const GET = defineRoute(
  { permission: 'platform:users:read', params: userIdParams },
  async ({ db, params }) => getUserDetail(db, params.id),
);
