import { defineRoute } from '@elevate/server-kit';
import { contactPreferencesBody } from '../../../../../../server/admissions-schemas';
import { idParams } from '../../../../../../server/schemas';
import { recordContactPreferences } from '../../../../../../server/students';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/admissions/[id]/contact-preferences — Consent and communication preferences (needs ops:student_private:read too). */
export const PUT = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: contactPreferencesBody },
  async ({ user, db, params, body, requestId }) =>
    recordContactPreferences(db, user, params.id, body, requestId),
);
