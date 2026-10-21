import { defineRoute } from '@elevate/server-kit';
import { dismissDuplicateFlag } from '../../../../../../server/lead-duplicates';
import { duplicateReviewBody, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/duplicates/[id] — Dismiss a duplicate flag after review. */
export const POST = defineRoute(
  { permission: 'ops:leads:merge', params: idParams, body: duplicateReviewBody },
  async ({ user, db, params, body, requestId }) =>
    dismissDuplicateFlag(db, user, params.id, body.note, requestId),
);
