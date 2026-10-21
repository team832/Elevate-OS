import { created, defineRoute } from '@elevate/server-kit';
import { recordItemStatus } from '../../../../../../../server/onboarding';
import {
  onboardingItemBody,
  onboardingItemParams,
} from '../../../../../../../server/profile-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/onboarding/[itemId] — Record an item status (append-only) and its owner / due date. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: onboardingItemParams, body: onboardingItemBody },
  async ({ user, db, params, body, requestId }) =>
    created(await recordItemStatus(db, user, params.id, params.itemId, body, requestId)),
);
