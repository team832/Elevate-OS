import { defineRoute } from '@elevate/server-kit';
import { getApplication } from '../../../../../../server/hr/recruitment';
import { idParams } from '../../../../../../server/hr/lifecycle-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/applications/{id} — Application with stage history, interviews and offers. */
export const GET = defineRoute(
  { permission: 'ops:recruitment:read', params: idParams },
  async ({ user, db, params }) => getApplication(db, user, params.id),
);
