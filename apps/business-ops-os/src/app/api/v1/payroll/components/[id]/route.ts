import { defineRoute } from '@elevate/server-kit';
import { setComponentStatus } from '../../../../../../server/payroll';
import { componentStatusBody } from '../../../../../../server/payroll-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/payroll/components/:id — retire a component (no new salary uses it) or restore it. */
export const PATCH = defineRoute(
  { permission: 'ops:payroll:manage', params: idParams, body: componentStatusBody },
  ({ db, user, params, body, requestId }) =>
    setComponentStatus(db, user, params.id, body.status, requestId),
);
