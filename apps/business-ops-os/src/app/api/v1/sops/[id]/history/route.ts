import { defineRoute } from '@elevate/server-kit';
import { getSopHistory } from '../../../../../../server/sops';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/sops/[id]/history — Change history from the audit log, newest first. */
export const GET = defineRoute(
  { permission: 'ops:sops:read', params: idParams },
  async ({ user, db, params }) => getSopHistory(db, user, params.id),
);
