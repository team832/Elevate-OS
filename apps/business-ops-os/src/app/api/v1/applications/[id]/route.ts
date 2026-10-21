import { defineRoute } from '@elevate/server-kit';
import { saveApplication } from '../../../../../server/applications';
import { getApplication } from '../../../../../server/applications-read';
import { saveApplicationBody } from '../../../../../server/applications-schemas';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/applications/[id] — Application, versions, forms, signatures, approval and what still blocks confirmation (KYC only with ops:student_private:read). */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', params: idParams },
  async ({ user, db, params }) => getApplication(db, user, params.id),
);

/** PATCH /ops/api/v1/applications/[id] — Save; a material change makes a new version, back to draft, signatures invalidated. */
export const PATCH = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: saveApplicationBody },
  async ({ user, db, params, body, requestId }) =>
    saveApplication(db, user, params.id, body, requestId),
);
