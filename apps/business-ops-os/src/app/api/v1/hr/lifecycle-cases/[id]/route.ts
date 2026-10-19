import { defineRoute } from '@elevate/server-kit';
import { getLifecycleCase } from '../../../../../../server/hr/offboarding';
import { idParams } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/lifecycle-cases/{id} — Case with checklist, gaps and history. */
export const GET = defineRoute(
  { permission: 'ops:lifecycle:read', params: idParams },
  async ({ user, db, params }) => getLifecycleCase(db, user, params.id),
);
