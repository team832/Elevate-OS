import { created, defineRoute } from '@elevate/server-kit';
import { handoffRetryBody } from '../../../../../../server/admissions-schemas';
import { retryEnrolmentHandoff } from '../../../../../../server/enrolment';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/enrolment-retry — New handoff attempt after Academic's delivery is dead (reason required, audited). */
export const POST = defineRoute(
  {
    permission: 'ops:admissions:write',
    params: idParams,
    body: handoffRetryBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await retryEnrolmentHandoff(db, user, params.id, body, requestId)),
);
