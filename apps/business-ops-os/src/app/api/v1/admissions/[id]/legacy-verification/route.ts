import { defineRoute } from '@elevate/server-kit';
import { verifyLegacyAdmission } from '../../../../../../server/applications-confirm';
import { legacyVerificationBody } from '../../../../../../server/applications-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/legacy-verification — Record that a legacy admission's paper evidence was checked (never creates an approval or a signed form). */
export const POST = defineRoute(
  { permission: 'ops:admissions:confirm', params: idParams, body: legacyVerificationBody },
  async ({ user, db, params, body, requestId }) =>
    verifyLegacyAdmission(db, user, params.id, body, requestId),
);
