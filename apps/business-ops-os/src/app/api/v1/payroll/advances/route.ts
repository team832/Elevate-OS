import { defineRoute } from '@elevate/server-kit';
import { createAdvance } from '../../../../../server/payroll';
import { advanceBody } from '../../../../../server/payroll-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/advances — a salary advance recovered in monthly instalments. */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', body: advanceBody, idempotency: 'optional' },
  ({ db, user, body, requestId }) => createAdvance(db, user, body, requestId),
);
