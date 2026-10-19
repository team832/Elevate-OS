import { defineRoute } from '@elevate/server-kit';
import { getEmployee, updateEmployee } from '../../../../../../server/hr/employees';
import { staffIdParams, updateEmployeeBody } from '../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees/[id] — Employee profile (fields per caller's tier). */
export const GET = defineRoute(
  { permission: 'ops:employees:read', params: staffIdParams },
  async ({ user, db, params }) => getEmployee(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/employees/[id] — Authorised edit; writes employment history. */
export const PATCH = defineRoute(
  { permission: 'ops:employees:manage', params: staffIdParams, body: updateEmployeeBody },
  async ({ user, db, params, body, requestId }) =>
    updateEmployee(db, user, params.id, body, requestId),
);
