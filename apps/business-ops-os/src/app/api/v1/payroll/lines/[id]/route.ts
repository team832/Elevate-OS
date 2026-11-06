import { defineRoute } from '@elevate/server-kit';
import { removeLine } from '../../../../../../server/payroll';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** DELETE /ops/api/v1/payroll/lines/:id — remove a hand-made line from a draft. */
export const DELETE = defineRoute(
  { permission: 'ops:payroll:manage', params: idParams },
  ({ db, user, params, requestId }) => removeLine(db, user, params.id, requestId),
);
