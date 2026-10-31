import { defineRoute } from '@elevate/server-kit';
import { decideLeave } from '../../../../../../server/leave-applications';
import { leaveDecisionBody } from '../../../../../../server/attendance-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave-applications/:id — Approve (writes the leave record) or reject (reason required); within setting hr.leave_approver and HR's scope, never your own, stale version 409. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams, body: leaveDecisionBody },
  async ({ user, db, params, body, requestId }) => decideLeave(db, user, params.id, body, requestId),
);
