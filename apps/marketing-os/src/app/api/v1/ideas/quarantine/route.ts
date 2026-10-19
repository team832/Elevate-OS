import { defineRoute } from '@elevate/server-kit';
import { listQuarantine } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/ideas/quarantine — duplicate legacy IDs held for OD-003. */
export const GET = defineRoute({ permission: 'marketing:ideas:read' }, async ({ db }) =>
  listQuarantine(db),
);
