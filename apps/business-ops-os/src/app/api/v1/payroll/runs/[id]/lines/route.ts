import { defineRoute } from '@elevate/server-kit';
import { addLine } from '../../../../../../../server/payroll';
import { lineBody } from '../../../../../../../server/payroll-schemas';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/payroll/runs/:id/lines — a one-off line or a correction of an earlier month (draft only). */
export const POST = defineRoute(
  { permission: 'ops:payroll:manage', params: idParams, body: lineBody, idempotency: 'optional' },
  ({ db, user, params, body, requestId }) => addLine(db, user, params.id, body, requestId),
);
