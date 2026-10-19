import { created, defineRoute } from '@elevate/server-kit';
import { startOnboarding } from '../../../../../../server/organisation';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff/[id]/onboarding — Create the default onboarding checklist. */
export const POST = defineRoute(
  { permission: 'ops:organisation:manage', params: idParams },
  async ({ user, db, params, requestId }) =>
    created(await startOnboarding(db, user, params.id, requestId)),
);
