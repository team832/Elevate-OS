import { created, defineRoute } from '@elevate/server-kit';
import { addMitigation, listMitigations } from '../../../../../../server/planning';
import { idParams } from '../../../../../../server/schemas';
import { mitigationBody } from '../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/risks/[id]/mitigations — Mitigation actions of a risk. */
export const GET = defineRoute(
  { permission: 'ops:risks:read', params: idParams },
  async ({ user, db, params }) => listMitigations(db, user, params.id),
);

/** POST /ops/api/v1/risks/[id]/mitigations — Add a mitigation action (owner, due date). */
export const POST = defineRoute(
  { permission: 'ops:risks:write', params: idParams, body: mitigationBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addMitigation(db, user, params.id, body, requestId)),
);
