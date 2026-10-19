import { defineRoute } from '@elevate/server-kit';
import { listLeadSources } from '../../../../server/leads';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/lead-sources — Configured lead sources. */
export const GET = defineRoute({ permission: 'ops:leads:read' }, async ({ db }) =>
  listLeadSources(db),
);
