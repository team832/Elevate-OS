import { created, defineRoute } from '@elevate/server-kit';
import { setDemoChecklistItem } from '../../../../../../server/demos';
import { checklistBody } from '../../../../../../server/demos-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/demos/[id]/checklist — Append a checklist entry (latest per item wins). */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: checklistBody },
  async ({ user, db, params, body, requestId }) =>
    created(await setDemoChecklistItem(db, user, params.id, body, requestId)),
);
