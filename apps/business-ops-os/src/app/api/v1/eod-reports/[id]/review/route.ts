import { defineRoute } from '@elevate/server-kit';
import { reviewReport } from '../../../../../../server/eod-review';
import { eodReviewBody } from '../../../../../../server/eod-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/review — Mark viewed, comment, ask for clarification or a revision, or acknowledge (the recipient or an EOD reviewer; never your own). */
export const POST = defineRoute(
  { permission: 'ops:tasks:read', params: idParams, body: eodReviewBody },
  async ({ user, db, params, body, requestId }) =>
    reviewReport(db, user, params.id, body, requestId),
);
