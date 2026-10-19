import { defineRoute } from '@elevate/server-kit';
import { getRequisition, updateRequisition } from '../../../../../../server/hr/recruitment';
import { idParams, updateRequisitionBody } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/requisitions/{id} — Requisition detail with its applications. */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', params: idParams },
  async ({ user, db, params }) => getRequisition(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/requisitions/{id} — Edit a draft, open or on-hold requisition. */
export const PATCH = defineRoute(
  { permission: 'ops:recruitment:manage', params: idParams, body: updateRequisitionBody },
  async ({ user, db, params, body, requestId }) =>
    updateRequisition(db, user, params.id, body, requestId),
);
