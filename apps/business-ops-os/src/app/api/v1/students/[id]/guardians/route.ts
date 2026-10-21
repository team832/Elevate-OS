import { created, defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { addGuardian } from '../../../../../../server/students';
import { guardianBody } from '../../../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/guardians — Add a guardian (restricted; needs ops:student_private:read too). */
export const POST = defineRoute(
  { permission: 'ops:guardians:write', params: idParams, body: guardianBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addGuardian(db, user, params.id, body, requestId)),
);
