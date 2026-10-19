import { defineRoute } from '@elevate/server-kit';
import { listSettings } from '../../../../server/settings';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/settings — Configuration with decision states. */
export const GET = defineRoute({ permission: 'ops:settings:read' }, async ({ user, db }) =>
  listSettings(db, user),
);
