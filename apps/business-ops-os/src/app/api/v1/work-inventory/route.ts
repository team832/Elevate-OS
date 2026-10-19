import { defineRoute } from '@elevate/server-kit';
import { listWorkInventory } from '../../../../server/planning';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/work-inventory — Imported legacy work inventory. */
export const GET = defineRoute({ permission: 'ops:risks:read' }, async ({ user, db }) =>
  listWorkInventory(db, user),
);
