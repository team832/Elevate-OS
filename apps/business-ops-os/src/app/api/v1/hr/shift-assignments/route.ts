import { created, defineRoute } from '@elevate/server-kit';
import { createShiftAssignment, listShiftAssignments } from '../../../../../server/hr/shifts';
import { assignmentListQuery, createAssignmentBody } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/shift-assignments — assignments (HR scope). */
export const GET = defineRoute(
  { permission: 'ops:shifts:read', query: assignmentListQuery },
  async ({ user, db, query }) => listShiftAssignments(db, user, query),
);

/** POST /ops/api/v1/hr/shift-assignments — assign a shift; overlapping assignments → 409. */
export const POST = defineRoute(
  { permission: 'ops:shifts:manage', body: createAssignmentBody },
  async ({ user, db, body, requestId }) =>
    created(await createShiftAssignment(db, user, body, requestId)),
);
