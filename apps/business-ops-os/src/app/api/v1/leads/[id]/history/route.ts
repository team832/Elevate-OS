import { defineRoute } from '@elevate/server-kit';
import { getLead } from '../../../../../../server/leads';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/leads/[id]/history — Audit history of the lead and linked records. */
export const GET = defineRoute(
  { permission: 'ops:leads:read', params: idParams },
  async ({ user, db, params }) => (await getLead(db, user, params.id)).history,
);
