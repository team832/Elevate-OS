import { created, defineRoute } from '@elevate/server-kit';
import { changeChecklist, getOnboarding } from '../../../../../../server/onboarding';
import { onboardingBody } from '../../../../../../server/profile-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/[id]/onboarding — Onboarding checklist with statuses, history and materials. */
export const GET = defineRoute(
  { permission: 'ops:students:read', params: idParams },
  async ({ user, db, params }) => getOnboarding(db, user, params.id),
);

/** POST /ops/api/v1/students/[id]/onboarding — Add items from the matching templates (generate) or one item by hand (add). */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: onboardingBody },
  async ({ user, db, params, body, requestId }) =>
    created(await changeChecklist(db, user, params.id, body, requestId)),
);
