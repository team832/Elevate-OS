import { defineRoute } from '@elevate/server-kit';
import { listEmploymentHistory } from '../../../../../../../server/hr/employees';
import { staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees/[id]/history — Append-only employment history. */
export const GET = defineRoute(
  { permission: 'ops:employees:read', params: staffIdParams },
  async ({ user, db, params }) => listEmploymentHistory(db, user, params.id),
);
