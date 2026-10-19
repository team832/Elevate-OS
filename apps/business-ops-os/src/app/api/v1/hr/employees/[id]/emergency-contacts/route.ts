import { created, defineRoute } from '@elevate/server-kit';
import { addEmergencyContact } from '../../../../../../../server/hr/private';
import { emergencyContactBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/employees/[id]/emergency-contacts — Add an emergency contact. */
export const POST = defineRoute(
  { permission: 'ops:employee_private:manage', params: staffIdParams, body: emergencyContactBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addEmergencyContact(db, user, params.id, body, requestId)),
);
