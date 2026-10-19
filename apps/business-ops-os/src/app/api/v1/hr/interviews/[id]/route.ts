import { defineRoute } from '@elevate/server-kit';
import { updateInterview } from '../../../../../../server/hr/recruitment';
import { idParams, updateInterviewBody } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/interviews/{id} — Reschedule, or mark completed / cancelled / no-show. */
export const PATCH = defineRoute(
  { permission: 'ops:recruitment:manage', params: idParams, body: updateInterviewBody },
  async ({ user, db, params, body, requestId }) =>
    updateInterview(db, user, params.id, body, requestId),
);
