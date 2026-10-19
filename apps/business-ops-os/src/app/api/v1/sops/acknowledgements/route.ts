import { defineRoute } from '@elevate/server-kit';
import { listOutstandingAcknowledgements } from '../../../../../server/sops';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/sops/acknowledgements — Outstanding acknowledgements per live SOP (counts). */
export const GET = defineRoute({ permission: 'ops:sops:read' }, async ({ user, db }) =>
  listOutstandingAcknowledgements(db, user),
);
