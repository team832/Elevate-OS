import { defineRoute } from '@elevate/server-kit';
import { listDuplicateQueue } from '../../../../../server/leads';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads/duplicates — Open duplicate flags (merge-review queue). */
export const GET = defineRoute({ permission: 'ops:leads:merge' }, async ({ user, db }) =>
  listDuplicateQueue(db, user),
);
