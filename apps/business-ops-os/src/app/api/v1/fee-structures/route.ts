import { defineRoute } from '@elevate/server-kit';
import { listFeeStructures } from '../../../../server/fees';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/fee-structures — The fee structure: one row per combination and mode, each with its source. */
export const GET = defineRoute({ permission: 'ops:fees:read' }, async ({ user, db }) =>
  listFeeStructures(db, user),
);
