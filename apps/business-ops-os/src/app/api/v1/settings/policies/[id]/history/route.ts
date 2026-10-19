import { defineRoute } from '@elevate/server-kit';
import { getPolicyHistory } from '../../../../../../../server/policies-register';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/settings/policies/[id]/history — Change history from the audit log. */
export const GET = defineRoute(
  { permission: 'ops:settings:read', params: idParams },
  async ({ user, db, params }) => getPolicyHistory(db, user, params.id),
);
