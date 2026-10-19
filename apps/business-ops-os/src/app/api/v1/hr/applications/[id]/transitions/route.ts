import { defineRoute } from '@elevate/server-kit';
import { transitionApplication } from '../../../../../../../server/hr/recruitment';
import {
  applicationTransitionBody,
  idParams,
} from '../../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/applications/{id}/transitions — Move the application to another stage. */
export const POST = defineRoute(
  {
    permission: { anyOf: ['ops:recruitment:manage', 'ops:recruitment:decide'] },
    params: idParams,
    body: applicationTransitionBody,
  },
  async ({ user, db, params, body, requestId }) =>
    transitionApplication(db, user, params.id, body, requestId),
);
