import { defineRoute } from '@elevate/server-kit';
import { listAssetsForEmployee } from '../../../../../../../server/hr/assets';
import { staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees/[id]/assets — Assets assigned to the employee (current and past). */
export const GET = defineRoute(
  { permission: 'ops:assets:read', params: staffIdParams },
  async ({ user, db, params }) => listAssetsForEmployee(db, user, params.id),
);
