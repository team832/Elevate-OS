import { created, defineRoute } from '@elevate/server-kit';
import { createApplication, listApplications } from '../../../../../server/hr/recruitment';
import {
  applicationListQuery,
  createApplicationBody,
} from '../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/applications — Applications (views: all in scope, interviewing me). */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', query: applicationListQuery },
  async ({ user, db, query }) => listApplications(db, user, query),
);

/** POST /ops/api/v1/hr/applications — Record a candidate's application to an open requisition. */
export const POST = defineRoute(
  { permission: 'ops:recruitment:manage', body: createApplicationBody },
  async ({ user, db, body, requestId }) =>
    created(await createApplication(db, user, body, requestId)),
);
