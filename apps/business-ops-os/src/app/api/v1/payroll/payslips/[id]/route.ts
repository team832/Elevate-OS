import { defineRoute } from '@elevate/server-kit';
import { markPaid } from '../../../../../../server/payroll';
import { paidBody } from '../../../../../../server/payroll-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/payslips/:id — mark a payslip of an approved payroll paid (date, mode, reference). */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', params: idParams, body: paidBody },
  ({ db, user, params, body, requestId }) => markPaid(db, user, params.id, body, requestId),
);
