import { created, defineRoute } from '@elevate/server-kit';
import { logActivity } from '../../../../../../server/leads';
import { contactActivityBody } from '../../../../../../server/lead-stages-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/activities — Log a contact attempt; a successful two-way contact moves new admissions to contacted. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: contactActivityBody },
  async ({ user, db, params, body, requestId }) =>
    created(await logActivity(db, user, params.id, body, requestId)),
);
