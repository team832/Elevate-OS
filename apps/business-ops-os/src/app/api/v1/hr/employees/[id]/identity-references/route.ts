import { created, defineRoute } from '@elevate/server-kit';
import { addIdentityReference } from '../../../../../../../server/hr/private';
import { identityReferenceBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/employees/[id]/identity-references — Record an identity reference (last 4 only). */
export const POST = defineRoute(
  { permission: 'ops:employee_private:manage', params: staffIdParams, body: identityReferenceBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addIdentityReference(db, user, params.id, body, requestId)),
);
