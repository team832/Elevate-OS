import { defineRoute } from '@elevate/server-kit';
import { getDirectory } from '../../../../server/organisation';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/organisation — Departments, staff, responsibilities and gap report. */
export const GET = defineRoute({ permission: 'ops:organisation:read' }, async ({ user, db }) =>
  getDirectory(db, user),
);
