import { created, defineRoute } from '@elevate/server-kit';
import { createSop, listSops } from '../../../../server/sops';
import { createSopBody } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/sops — SOP register. */
export const GET = defineRoute({ permission: 'ops:sops:read' }, async ({ user, db }) =>
  listSops(db, user),
);

/** POST /ops/api/v1/sops — Create an SOP with draft version 0.1. */
export const POST = defineRoute(
  { permission: 'ops:sops:write', body: createSopBody },
  async ({ user, db, body, requestId }) => created(await createSop(db, user, body, requestId)),
);
