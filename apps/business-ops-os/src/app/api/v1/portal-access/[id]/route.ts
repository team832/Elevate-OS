import { defineRoute } from '@elevate/server-kit';
import { accessStatusBody, setPortalAccess } from '../../../../../server/portal-access';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/portal-access/[id] — Switch a portal login off (its sessions and setup code end) or back on. */
export const PATCH = defineRoute(
  { permission: 'ops:guardians:write', params: idParams, body: accessStatusBody },
  async ({ user, db, params, body, requestId }) =>
    setPortalAccess(db, user, params.id, body.enabled, requestId),
);
