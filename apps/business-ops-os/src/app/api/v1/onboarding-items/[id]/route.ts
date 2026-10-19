import { defineRoute } from '@elevate/server-kit';
import { updateOnboardingItem } from '../../../../../server/organisation';
import { idParams, onboardingItemBody } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/onboarding-items/[id] — Update an onboarding item (document reference only). */
export const PATCH = defineRoute(
  { permission: 'ops:organisation:manage', params: idParams, body: onboardingItemBody },
  async ({ user, db, params, body, requestId }) =>
    updateOnboardingItem(db, user, params.id, body, requestId),
);
