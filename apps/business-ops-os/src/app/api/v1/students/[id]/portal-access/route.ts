import { created, defineRoute } from '@elevate/server-kit';
import {
  giveAccessBody,
  givePortalAccess,
  portalAccessFor,
} from '../../../../../../server/portal-access';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/students/[id]/portal-access — The student's portal logins (F4-13); needs ops:student_private:read. */
export const GET = defineRoute(
  { permission: 'ops:student_private:read', params: idParams },
  async ({ user, db, params }) => portalAccessFor(db, user, params.id),
);

/** POST /ops/api/v1/students/[id]/portal-access — Give the student or a guardian a portal login (consent first for a minor). */
export const POST = defineRoute(
  {
    permission: 'ops:guardians:write',
    params: idParams,
    body: giveAccessBody,
    idempotency: 'optional',
  },
  async ({ user, db, params, body, requestId }) =>
    created(await givePortalAccess(db, user, params.id, body, requestId)),
);
