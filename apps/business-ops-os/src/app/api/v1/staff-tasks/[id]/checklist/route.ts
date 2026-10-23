import { defineRoute } from '@elevate/server-kit';
import { idParams } from '../../../../../../server/schemas';
import { checklistBody } from '../../../../../../server/staff-tasks-schemas';
import { setChecklistItem } from '../../../../../../server/task-checklist';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/staff-tasks/:id/checklist — Tick or untick one checklist item `{ itemId, done }` (404 outside your scope). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: idParams, body: checklistBody, idempotency: 'optional' },
  async ({ user, db, params, body, requestId }) =>
    setChecklistItem(db, user, params.id, body, requestId),
);
