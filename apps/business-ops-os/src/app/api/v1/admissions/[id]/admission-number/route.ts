import { defineRoute } from '@elevate/server-kit';
import { overrideAdmissionNumber } from '../../../../../../server/conversion';
import { idParams } from '../../../../../../server/schemas';
import { admissionNumberBody } from '../../../../../../server/students-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/admissions/[id]/admission-number — Change the admission number by hand (reason ≥ 10 characters; logged in admission_number_changes). */
export const POST = defineRoute(
  { permission: 'ops:admission_number:override', params: idParams, body: admissionNumberBody },
  async ({ user, db, params, body, requestId }) =>
    overrideAdmissionNumber(db, user, params.id, body, requestId),
);
