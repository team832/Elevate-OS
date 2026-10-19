import { defineRoute } from '@elevate/server-kit';
import { getAdmission, updateAdmission } from '../../../../../server/admissions';
import { idParams, updateAdmissionBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/admissions/[id] — Admission detail with readiness, checklist, approvals and handoff status. */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', params: idParams },
  async ({ user, db, params }) => getAdmission(db, user, params.id),
);

/** PATCH /ops/api/v1/admissions/[id] — Edit programme, counsellor (managers), mode, intended start/course/batch. */
export const PATCH = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: updateAdmissionBody },
  async ({ user, db, params, body, requestId }) =>
    updateAdmission(db, user, params.id, body, requestId),
);
