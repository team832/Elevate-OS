import { defineRoute } from '@elevate/server-kit';
import { refreshOffboardingChecklist } from '../../../../../../../server/hr/offboarding';
import { idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/lifecycle-cases/{id}/refresh — Add items for assets or work picked up since the case opened. */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:manage', params: idParams },
  async ({ user, db, params, requestId }) =>
    refreshOffboardingChecklist(db, user, params.id, requestId),
);
