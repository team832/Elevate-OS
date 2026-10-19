import { defineRoute } from '@elevate/server-kit';
import { updateCaseItem } from '../../../../../../../../server/hr/onboarding';
import {
  caseItemParams,
  updateItemBody,
} from '../../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/lifecycle-cases/{id}/items/{itemId} — Update a checklist item. */
export const PATCH = defineRoute(
  { permission: 'ops:lifecycle:manage', params: caseItemParams, body: updateItemBody },
  async ({ user, db, params, body, requestId }) =>
    updateCaseItem(db, user, params.id, params.itemId, body, requestId),
);
