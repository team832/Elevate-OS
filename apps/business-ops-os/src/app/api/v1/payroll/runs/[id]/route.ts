import { defineRoute } from '@elevate/server-kit';
import { runAction } from '../../../../../../server/payroll';
import { runActionBody } from '../../../../../../server/payroll-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/payroll/runs/:id — `rebuild` or `submit` a draft (ops:payroll:manage), `return` a
 * submitted run to draft, or `approve` it (ops:payroll:approve; not who started or submitted it).
 */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:payroll:manage', 'ops:payroll:approve'] },
    params: idParams,
    body: runActionBody,
  },
  ({ db, user, params, body, requestId }) => runAction(db, user, params.id, body.action, requestId),
);
