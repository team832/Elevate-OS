import { created, defineRoute } from '@elevate/server-kit';
import { addCaseItem } from '../../../../../../../server/hr/onboarding';
import { addItemBody, idParams } from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/lifecycle-cases/{id}/items — Add a custom checklist item. */
export const POST = defineRoute(
  { permission: 'ops:lifecycle:manage', params: idParams, body: addItemBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addCaseItem(db, user, params.id, body, requestId)),
);
