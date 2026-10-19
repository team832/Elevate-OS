import { created, defineRoute } from '@elevate/server-kit';
import { addTaskReference } from '../../../../../../server/tasks';
import { idParams } from '../../../../../../server/schemas';
import { taskReferenceBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/references — Add a document/evidence REFERENCE (no file storage). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: taskReferenceBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addTaskReference(db, user, params.id, body, requestId)),
);
