import { created, defineRoute } from '@elevate/server-kit';
import { createShiftTemplate, listShiftTemplates } from '../../../../../server/hr/shifts';
import { createShiftBody } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/shifts — shift templates. */
export const GET = defineRoute({ permission: 'ops:shifts:read' }, async ({ user, db }) =>
  listShiftTemplates(db, user),
);

/** POST /ops/api/v1/hr/shifts — new shift template (starts proposed). */
export const POST = defineRoute(
  { permission: 'ops:shifts:manage', body: createShiftBody },
  async ({ user, db, body, requestId }) =>
    created(await createShiftTemplate(db, user, body, requestId)),
);
