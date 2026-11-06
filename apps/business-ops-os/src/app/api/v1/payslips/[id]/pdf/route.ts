import { defineRoute } from '@elevate/server-kit';
import { payslipFile } from '../../../../../../server/payroll-read';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET <base>/api/v1/payslips/:id/pdf — one payslip: your own once approved (ops:payslips:read), or
 * any for payroll holders; anything else is "not found". Audited.
 */
export const GET = defineRoute(
  {
    permission: { anyOf: ['ops:payslips:read', 'ops:payroll:manage', 'ops:payroll:approve'] },
    params: idParams,
  },
  ({ db, user, params }) => payslipFile(db, user, params.id),
);
