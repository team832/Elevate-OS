import { created, defineRoute } from '@elevate/server-kit';
import { createDepartment } from '../../../../server/organisation';
import { createDepartmentBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/departments — Create a department (provisional). */
export const POST = defineRoute(
  { permission: 'ops:organisation:manage', body: createDepartmentBody },
  async ({ user, db, body, requestId }) =>
    created(await createDepartment(db, user, body, requestId)),
);
