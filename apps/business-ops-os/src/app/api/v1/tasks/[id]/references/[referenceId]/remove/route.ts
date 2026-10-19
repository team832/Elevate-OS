import { defineRoute } from '@elevate/server-kit';
import { removeTaskReference } from '../../../../../../../../server/tasks';
import { referenceParams, removeReferenceBody } from '../../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/references/[referenceId]/remove — Soft-remove a reference with a reason. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: referenceParams, body: removeReferenceBody },
  async ({ user, db, params, body, requestId }) =>
    removeTaskReference(db, user, params.id, params.referenceId, body, requestId),
);
