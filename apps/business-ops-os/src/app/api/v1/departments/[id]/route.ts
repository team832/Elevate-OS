import { defineRoute } from '@elevate/server-kit';
import { updateDepartment } from '../../../../../server/organisation';
import { idParams, updateDepartmentBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/departments/[id] — Rename, confirm or archive a department. */
export const PATCH = defineRoute(
  { permission: 'ops:organisation:manage', params: idParams, body: updateDepartmentBody },
  async ({ user, db, params, body, requestId }) =>
    updateDepartment(db, user, params.id, body, requestId),
);
