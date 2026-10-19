import { defineRoute } from '@elevate/server-kit';
import { transitionAdmission } from '../../../../../../server/admissions';
import { codedTransitionBody } from '../../../../../../server/admissions-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/transitions — Move the admission along the legal-transition table; closing (→ lost) takes an optional reason code. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: codedTransitionBody },
  async ({ user, db, params, body, requestId }) =>
    transitionAdmission(db, user, params.id, body, requestId),
);
