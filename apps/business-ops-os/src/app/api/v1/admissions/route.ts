import { defineRoute } from '@elevate/server-kit';
import { listAdmissions } from '../../../../server/admissions';
import { listAdmissionsQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions — Admissions pipeline board. */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', query: listAdmissionsQuery },
  async ({ user, db, query }) => listAdmissions(db, user, query),
);
