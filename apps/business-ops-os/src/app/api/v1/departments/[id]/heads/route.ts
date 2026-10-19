import { created, defineRoute } from '@elevate/server-kit';
import { assignDepartmentHead, endDepartmentHead } from '../../../../../../server/hr/org-history';
import { assignHeadBody, endHeadBody, staffIdParams } from '../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/departments/[id]/heads — Appoint a head (the current head's tenure ends the day before). */
export const POST = defineRoute(
  { permission: 'ops:organisation:manage', params: staffIdParams, body: assignHeadBody },
  async ({ user, db, params, body, requestId }) =>
    created(await assignDepartmentHead(db, user, params.id, body, requestId)),
);

/** PATCH /ops/api/v1/departments/[id]/heads — End the current head's tenure without a successor. */
export const PATCH = defineRoute(
  { permission: 'ops:organisation:manage', params: staffIdParams, body: endHeadBody },
  async ({ user, db, params, body, requestId }) =>
    endDepartmentHead(db, user, params.id, body, requestId),
);
