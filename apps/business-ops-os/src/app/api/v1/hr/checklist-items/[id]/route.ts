import { defineRoute } from '@elevate/server-kit';
import { checklistItemBody, setChecklistItem } from '../../../../../../server/hr-staff-records';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/checklist-items/:id — mark an item done, not applicable or pending (F4-09). */
export const POST = defineRoute(
  { permission: 'ops:staff:manage', params: idParams, body: checklistItemBody },
  async ({ user, db, params, body, requestId }) =>
    setChecklistItem(db, user, params.id, body, requestId),
);
