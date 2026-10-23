import { defineRoute } from '@elevate/server-kit';
import { directoryQuery } from '../../../../../server/hr-schemas';
import { getDirectory } from '../../../../../server/organisation';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/staff — HR staff directory (HR's department scope), filtered, 25 a page. */
export const GET = defineRoute(
  { permission: 'ops:hr:read', query: directoryQuery },
  async ({ user, db, query }) => getDirectory(db, user, query, 'hr'),
);
