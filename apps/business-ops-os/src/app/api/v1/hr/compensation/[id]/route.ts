import { defineRoute } from '@elevate/server-kit';
import { updateCompensationDraft } from '../../../../../../server/hr/compensation';
import { staffIdParams, updateCompensationBody } from '../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/compensation/[id] — Edit a draft. */
export const PATCH = defineRoute(
  { permission: 'ops:compensation:manage', params: staffIdParams, body: updateCompensationBody },
  async ({ user, db, params, body, requestId }) =>
    updateCompensationDraft(db, user, params.id, body, requestId),
);
