import { created, defineRoute } from '@elevate/server-kit';
import { createCompensationDraft, listCompensation } from '../../../../../server/hr/compensation';
import { compensationListQuery, createCompensationBody } from '../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/compensation — Compensation records (records only, not payroll). */
export const GET = defineRoute(
  { permission: 'ops:compensation:read', query: compensationListQuery },
  async ({ user, db, query }) => listCompensation(db, user, query),
);

/** POST /ops/api/v1/hr/compensation — Draft a compensation record. */
export const POST = defineRoute(
  { permission: 'ops:compensation:manage', body: createCompensationBody },
  async ({ user, db, body, requestId }) =>
    created(await createCompensationDraft(db, user, body, requestId)),
);
