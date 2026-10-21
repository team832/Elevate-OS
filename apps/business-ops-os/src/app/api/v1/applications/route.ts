import { created, defineRoute } from '@elevate/server-kit';
import { startDirectApplication } from '../../../../server/applications';
import { listApplications } from '../../../../server/applications-read';
import {
  applicationListQuery,
  directApplicationBody,
} from '../../../../server/applications-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/applications — Admission applications: search, status, sort, 25 per page (own scope for counsellors). */
export const GET = defineRoute(
  { permission: 'ops:admissions:read', query: applicationListQuery },
  async ({ user, db, query }) => listApplications(db, user, query),
);

/** POST /ops/api/v1/applications — New direct admission: an application draft for an "admission pending" case without a demo. */
export const POST = defineRoute(
  { permission: 'ops:admissions:write', body: directApplicationBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) =>
    created(await startDirectApplication(db, user, body, requestId)),
);
