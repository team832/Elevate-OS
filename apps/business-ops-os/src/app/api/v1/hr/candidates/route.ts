import { created, defineRoute } from '@elevate/server-kit';
import { createCandidate, listCandidates } from '../../../../../server/hr/recruitment';
import {
  candidateListQuery,
  createCandidateBody,
} from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/candidates — Candidates (no contact details in the list). */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', query: candidateListQuery },
  async ({ user, db, query }) => listCandidates(db, user, query),
);

/** POST /ops/api/v1/hr/candidates — Add a candidate (contacts normalised; duplicates refused). */
export const POST = defineRoute(
  { permission: 'ops:recruitment:manage', body: createCandidateBody },
  async ({ user, db, body, requestId }) =>
    created(await createCandidate(db, user, body, requestId)),
);
