import { created, defineRoute } from '@elevate/server-kit';
import { createEmployee, listEmployees } from '../../../../../server/hr/employees';
import { createEmployeeBody, employeeListQuery } from '../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees — Employee directory (search, filters, sort, pagination; per-tier fields). */
export const GET = defineRoute(
  { permission: 'ops:employees:read', query: employeeListQuery },
  async ({ user, db, query }) => listEmployees(db, user, query),
);

/** POST /ops/api/v1/hr/employees — Create an employee (EMP-####) or register an existing staff member. */
export const POST = defineRoute(
  { permission: 'ops:employees:manage', body: createEmployeeBody },
  async ({ user, db, body, requestId }) => created(await createEmployee(db, user, body, requestId)),
);
