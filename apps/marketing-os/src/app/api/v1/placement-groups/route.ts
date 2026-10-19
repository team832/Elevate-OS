import { created, defineRoute } from '@elevate/server-kit';
import { createGroupBody, createPlacementGroup } from '../../../../server';

export const dynamic = 'force-dynamic';

/** POST /marketing/api/v1/placement-groups — a collab across accounts; 400 with the rule violations. */
export const POST = defineRoute(
  { permission: 'marketing:schedule:manage', body: createGroupBody },
  async ({ db, body, user, requestId }) =>
    created(await createPlacementGroup(db, user, body, requestId)),
);
