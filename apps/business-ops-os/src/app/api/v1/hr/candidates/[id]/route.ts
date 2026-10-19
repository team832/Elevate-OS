import { defineRoute } from '@elevate/server-kit';
import { getCandidate, updateCandidate } from '../../../../../../server/hr/recruitment';
import { idParams, updateCandidateBody } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/candidates/{id} — Candidate detail; contacts only for managers covering them. */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', params: idParams },
  async ({ user, db, params }) => getCandidate(db, user, params.id),
);

/** PATCH /ops/api/v1/hr/candidates/{id} — Edit a candidate. */
export const PATCH = defineRoute(
  { permission: 'ops:recruitment:manage', params: idParams, body: updateCandidateBody },
  async ({ user, db, params, body, requestId }) =>
    updateCandidate(db, user, params.id, body, requestId),
);
