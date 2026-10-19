import { defineRoute } from '@elevate/server-kit';
import { transitionOffer } from '../../../../../../../server/hr/recruitment';
import { idParams, offerTransitionBody } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/offers/{id}/transitions — Approve (not by the preparer), mark extended, accepted, declined, withdrawn or expired. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:recruitment:manage', 'ops:recruitment:decide'] },
    params: idParams,
    body: offerTransitionBody,
  },
  async ({ user, db, params, body, requestId }) =>
    transitionOffer(db, user, params.id, body, requestId),
);
