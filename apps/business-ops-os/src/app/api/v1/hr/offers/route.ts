import { created, defineRoute } from '@elevate/server-kit';
import { createOffer } from '../../../../../server/hr/recruitment';
import { createOfferBody } from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/offers — Prepare a draft offer (no salary: a compensation reference only). */
export const POST = defineRoute(
  { permission: 'ops:recruitment:manage', body: createOfferBody },
  async ({ user, db, body, requestId }) => created(await createOffer(db, user, body, requestId)),
);
