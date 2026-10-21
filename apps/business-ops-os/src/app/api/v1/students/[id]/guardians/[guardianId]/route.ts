import { defineRoute } from '@elevate/server-kit';
import { updateGuardian } from '../../../../../../../server/students';
import { guardianParams, guardianPatchBody } from '../../../../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/students/[id]/guardians/[guardianId] — Edit or archive a guardian (never deleted). */
export const PATCH = defineRoute(
  { permission: 'ops:guardians:write', params: guardianParams, body: guardianPatchBody },
  async ({ user, db, params, body, requestId }) =>
    updateGuardian(db, user, params.id, params.guardianId, body, requestId),
);
