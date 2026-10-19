import { defineRoute } from '@elevate/server-kit';
import {
  removeEmergencyContact,
  updateEmergencyContact,
} from '../../../../../../../../server/hr/private';
import {
  contactParams,
  updateEmergencyContactBody,
} from '../../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/employees/[id]/emergency-contacts/[contactId] — Edit an emergency contact. */
export const PATCH = defineRoute(
  {
    permission: 'ops:employee_private:manage',
    params: contactParams,
    body: updateEmergencyContactBody,
  },
  async ({ user, db, params, body, requestId }) =>
    updateEmergencyContact(db, user, params.id, params.contactId, body, requestId),
);

/** DELETE /ops/api/v1/hr/employees/[id]/emergency-contacts/[contactId] — Remove an emergency contact. */
export const DELETE = defineRoute(
  { permission: 'ops:employee_private:manage', params: contactParams },
  async ({ user, db, params, requestId }) =>
    removeEmergencyContact(db, user, params.id, params.contactId, requestId),
);
