import { defineRoute } from '@elevate/server-kit';
import { reviewReport } from '../../../../../../server/eod-reports';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/eod-reports/:id/review — Mark a submitted report reviewed: EOD reviewers or the manager it was sent to (not your own). */
export const POST = defineRoute(
  { permission: 'ops:tasks:read', params: idParams },
  async ({ user, db, params, requestId }) => reviewReport(db, user, params.id, requestId),
);
