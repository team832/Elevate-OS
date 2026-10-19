import { defineRoute } from '@elevate/server-kit';
import { retireIdentityReference } from '../../../../../../../../server/hr/private';
import {
  referenceParams,
  retireIdentityReferenceBody,
} from '../../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /ops/api/v1/hr/employees/[id]/identity-references/[refId] — Retire an identity reference. */
export const PATCH = defineRoute(
  {
    permission: 'ops:employee_private:manage',
    params: referenceParams,
    body: retireIdentityReferenceBody,
  },
  async ({ user, db, params, requestId }) =>
    retireIdentityReference(db, user, params.id, params.refId, requestId),
);
