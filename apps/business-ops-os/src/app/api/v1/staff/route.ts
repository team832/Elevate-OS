import { created, defineRoute } from '@elevate/server-kit';
import { createStaff } from '../../../../server/organisation';
import { createStaffBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff — Create a staff member (core.staff_members, steward). */
export const POST = defineRoute(
  { permission: 'ops:organisation:manage', body: createStaffBody },
  async ({ user, db, body, requestId }) => created(await createStaff(db, user, body, requestId)),
);
