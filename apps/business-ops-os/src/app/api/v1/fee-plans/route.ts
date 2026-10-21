import { created, defineRoute } from '@elevate/server-kit';
import {
  createFeePlan,
  feePlanCreateBody,
  feePlanListQuery,
  studentFeePlans,
} from '../../../../server/fees';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/fee-plans?studentId= — A student's fee plans, instalments and ledger (own scope for counsellors). */
export const GET = defineRoute(
  { permission: 'ops:fees:read', query: feePlanListQuery },
  async ({ user, db, query }) => studentFeePlans(db, user, query.studentId),
);

/** POST /ops/api/v1/fee-plans — Create a draft annual fee agreement: tuition split 50/25/25 (D-039), one due date per instalment. */
export const POST = defineRoute(
  { permission: 'ops:fees:record', body: feePlanCreateBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => created(await createFeePlan(db, user, body, requestId)),
);
