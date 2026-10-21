import { created, defineRoute } from '@elevate/server-kit';
import { recordMaterial } from '../../../../../../server/onboarding';
import { materialBody } from '../../../../../../server/profile-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/materials — Issue, return or replace books/material for a checklist item. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', params: idParams, body: materialBody },
  async ({ user, db, params, body, requestId }) =>
    created(await recordMaterial(db, user, params.id, body, requestId)),
);
