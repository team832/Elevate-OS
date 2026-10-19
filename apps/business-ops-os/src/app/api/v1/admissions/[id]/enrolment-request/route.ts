import { created, defineRoute } from '@elevate/server-kit';
import { requestEnrolment } from '../../../../../../server/enrolment';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/enrolment-request — admitted → enrolment_requested and publish ops.admission.enrolment_requested v1 in one transaction. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, idempotency: 'optional' },
  async ({ user, db, params, requestId }) =>
    created(await requestEnrolment(db, user, params.id, { requestId })),
);
