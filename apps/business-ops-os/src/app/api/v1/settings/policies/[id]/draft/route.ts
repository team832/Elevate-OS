import { defineRoute } from '@elevate/server-kit';
import { savePolicyDraft } from '../../../../../../../server/policies-register';
import { idParams } from '../../../../../../../server/schemas';
import { policyDraftBody } from '../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/settings/policies/[id]/draft — Save the text (edits the draft or starts a new version). */
export const PUT = defineRoute(
  { permission: 'ops:settings:manage', params: idParams, body: policyDraftBody },
  async ({ user, db, params, body, requestId }) =>
    savePolicyDraft(db, user, params.id, body, requestId),
);
