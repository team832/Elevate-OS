import { defineRoute } from '@elevate/server-kit';
import { createStructure } from '../../../../../server/payroll';
import { structureBody } from '../../../../../server/payroll-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/structures — a staff member's salary from the 1st of a month (history kept). */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', body: structureBody, idempotency: 'optional' },
  ({ db, user, body, requestId }) => createStructure(db, user, body, requestId),
);
