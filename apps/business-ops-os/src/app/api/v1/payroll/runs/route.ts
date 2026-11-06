import { defineRoute } from '@elevate/server-kit';
import { createRun } from '../../../../../server/payroll';
import { runBody } from '../../../../../server/payroll-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/runs — start a month's payroll: a draft built from salaries, leave and advances. */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', body: runBody },
  ({ db, user, body, requestId }) => createRun(db, user, body.month, requestId),
);
