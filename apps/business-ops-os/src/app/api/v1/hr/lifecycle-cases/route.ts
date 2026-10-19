import { created, defineRoute } from '@elevate/server-kit';
import { listCases } from '../../../../../server/hr/onboarding';
import { createLifecycleCase } from '../../../../../server/hr/offboarding';
import { caseListQuery, createCaseBody } from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/lifecycle-cases — Onboarding and offboarding cases in HR scope. */
export const GET = defineRoute(
  { permission: 'ops:lifecycle:read', query: caseListQuery },
  async ({ user, db, query }) => listCases(db, user, query),
);

/** POST /ops/api/v1/hr/lifecycle-cases — Open an onboarding or offboarding case (checklist generated). */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:manage', body: createCaseBody },
  async ({ user, db, body, requestId }) =>
    created(await createLifecycleCase(db, user, body, requestId)),
);
