import { defineRoute } from '@elevate/server-kit';
import { transitionRequisition } from '../../../../../../../server/hr/recruitment';
import {
  idParams,
  requisitionTransitionBody,
} from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/requisitions/{id}/transitions — Approve to open, hold, resume, fill or cancel. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:recruitment:manage', 'ops:recruitment:decide'] },
    params: idParams,
    body: requisitionTransitionBody,
  },
  async ({ user, db, params, body, requestId }) =>
    transitionRequisition(db, user, params.id, body, requestId),
);
