import { defineRoute } from '@elevate/server-kit';
import { anonymiseCandidate } from '../../../../../../../server/hr/recruitment';
import { confirmBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/candidates/{id}/anonymise — Remove personal data of a closed unsuccessful candidate. */
export const POST = defineRoute(
  { permission: 'ops:recruitment:decide', params: idParams, body: confirmBody },
  async ({ user, db, params, requestId }) => anonymiseCandidate(db, user, params.id, requestId),
);
