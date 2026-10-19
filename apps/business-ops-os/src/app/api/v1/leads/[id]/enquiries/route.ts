import { created, defineRoute } from '@elevate/server-kit';
import { addEnquiry } from '../../../../../../server/leads';
import { enquiryBody, idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/leads/[id]/enquiries — Attach a new enquiry to an existing lead. */
export const POST = defineRoute(
  { permission: 'ops:leads:write', params: idParams, body: enquiryBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addEnquiry(db, user, params.id, body, requestId)),
);
