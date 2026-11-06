import { defineRoute } from '@elevate/server-kit';
import { resendLeaveToAcademic } from '../../../../../../../server/leave-applications';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/attendance/leave/:id/send-to-academic — "Send to Academic again": the leave's current state (D-134); setting hr.leave_approver, HR scope, never your own; 409 when Academic OS does not answer. */
export const POST = defineRoute(
  { permission: 'ops:attendance:manage', params: idParams },
  async ({ user, db, params }) => resendLeaveToAcademic(db, user, params.id),
);
