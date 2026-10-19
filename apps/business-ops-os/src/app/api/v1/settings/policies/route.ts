import { created, defineRoute } from '@elevate/server-kit';
import { createPolicy, listPolicies } from '../../../../../server/policies-register';
import { createPolicyBody, policyListQuery } from '../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/settings/policies — Company policies & compliance obligations (filters: area, status, review). */
export const GET = defineRoute(
  { permission: 'ops:settings:read', query: policyListQuery },
  async ({ user, db, query }) => listPolicies(db, user, query),
);

/** POST /ops/api/v1/settings/policies — Record a new entry (draft, version 1). */
export const POST = defineRoute(
  { permission: 'ops:settings:manage', body: createPolicyBody },
  async ({ user, db, body, requestId }) => created(await createPolicy(db, user, body, requestId)),
);
