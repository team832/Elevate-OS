import { defineRoute } from '@elevate/server-kit';
import { updateProject } from '../../../../../server/planning';
import { idParams, updateProjectBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/projects/[id] — Update a project. */
export const PATCH = defineRoute(
  { permission: 'ops:risks:write', params: idParams, body: updateProjectBody },
  async ({ user, db, params, body, requestId }) =>
    updateProject(db, user, params.id, body, requestId),
);
