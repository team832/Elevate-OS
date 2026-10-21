import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { changeStudentLifecycle } from '../../../../../../server/students';
import { lifecycleBody } from '../../../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/lifecycle — Put on hold, resume, record an exit, readmit (new application), or reactivate (needs ops:students:reactivate). */
export const POST = defineRoute(
  { permission: 'ops:students:lifecycle', params: idParams, body: lifecycleBody },
  async ({ user, db, params, body, requestId }) =>
    changeStudentLifecycle(db, user, params.id, body, requestId),
);
