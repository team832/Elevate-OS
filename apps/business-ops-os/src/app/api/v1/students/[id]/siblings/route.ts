import { created, defineRoute } from '@elevate/server-kit';
import { linkSibling } from '../../../../../../server/kyc';
import { siblingBody } from '../../../../../../server/profile-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/students/[id]/siblings — Link a sibling's student record (never merges the two). */
export const POST = defineRoute(
  { permission: 'ops:guardians:write', params: idParams, body: siblingBody },
  async ({ user, db, params, body, requestId }) =>
    created(await linkSibling(db, user, params.id, body, requestId)),
);
