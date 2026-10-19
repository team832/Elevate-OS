import { created, defineRoute } from '@elevate/server-kit';
import { convertCandidate } from '../../../../../../../server/hr/recruitment';
import { convertBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/hr/applications/{id}/convert — Create the employee from the accepted
 * offer and open onboarding. Idempotent: a repeat returns the same employee (200).
 */
export const POST = defineRoute(
  { permission: 'ops:recruitment:decide', params: idParams, body: convertBody },
  async ({ user, db, params, body, requestId }) => {
    const result = await convertCandidate(db, user, params.id, body, requestId);
    return result.created ? created({ id: result.onboardingCaseId, ...result }) : result;
  },
);
