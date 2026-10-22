import { created, defineRoute } from '@elevate/server-kit';
import { createFollowUp } from '../../../../../../server/eod-review';
import { eodFollowUpBody } from '../../../../../../server/eod-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/follow-up — Create a follow-up task for the report's owner (reviewers; task write scope applies). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: eodFollowUpBody },
  async ({ user, db, params, body, requestId }) =>
    created(await createFollowUp(db, user, params.id, body, requestId)),
);
