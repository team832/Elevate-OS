import { created, defineRoute } from '@elevate/server-kit';
import { createRequisition, listRequisitions } from '../../../../../server/hr/recruitment';
import {
  createRequisitionBody,
  requisitionListQuery,
} from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/requisitions — Requisitions (search, status filter, sort, pages). */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', query: requisitionListQuery },
  async ({ user, db, query }) => listRequisitions(db, user, query),
);

/** POST /ops/api/v1/hr/requisitions — Request a requisition (created as draft). */
export const POST = defineRoute(
  { permission: 'ops:recruitment:manage', body: createRequisitionBody },
  async ({ user, db, body, requestId }) =>
    created(await createRequisition(db, user, body, requestId)),
);
