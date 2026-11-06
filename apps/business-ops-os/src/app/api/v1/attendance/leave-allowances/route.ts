import { defineRoute } from '@elevate/server-kit';
import { allowanceBody, allowanceListQuery } from '../../../../../server/attendance-schemas';
import { allowanceSheet, setAllowance } from '../../../../../server/leave-balances';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/attendance/leave-allowances — Leave balances per staff member and type for one leave year (F4-12); HR's staff scope, own scope = your own. */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: allowanceListQuery },
  async ({ user, db, query }) => allowanceSheet(db, user, query),
);

/** POST /ops/api/v1/attendance/leave-allowances — Set a year's allowance for one person or everyone with a role in HR's reach (never yourself); not for a type without a balance; audited. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', body: allowanceBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) => setAllowance(db, user, body, requestId),
);
