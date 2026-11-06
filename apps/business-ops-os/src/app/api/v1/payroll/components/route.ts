import { defineRoute } from '@elevate/server-kit';
import { createComponent } from '../../../../../server/payroll';
import { componentBody } from '../../../../../server/payroll-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/components — add an earning or deduction (F4-14). */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', body: componentBody, idempotency: 'optional' },
  ({ db, user, body, requestId }) => createComponent(db, user, body, requestId),
);
