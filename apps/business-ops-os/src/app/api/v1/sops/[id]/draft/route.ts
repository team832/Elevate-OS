import { defineRoute } from '@elevate/server-kit';
import { saveSopDraft } from '../../../../../../server/sops';
import { idParams, sopDraftBody } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PUT /ops/api/v1/sops/[id]/draft — Save draft content (new version if the current one is not a draft). */
export const PUT = defineRoute(
  { permission: 'ops:sops:write', params: idParams, body: sopDraftBody },
  async ({ user, db, params, body, requestId }) =>
    saveSopDraft(db, user, params.id, body, requestId),
);
