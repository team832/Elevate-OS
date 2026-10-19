import { created, defineRoute } from '@elevate/server-kit';
import { createCorrection, listCorrections } from '../../../../../server/hr/attendance';
import { correctionListQuery, createCorrectionBody } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance-corrections — correction requests (HR scope). */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: correctionListQuery },
  async ({ user, db, query }) => listCorrections(db, user, query),
);

/** POST /ops/api/v1/hr/attendance-corrections — request a correction (ATC-######). */
export const POST = defineRoute(
  { permission: 'ops:attendance:record', body: createCorrectionBody },
  async ({ user, db, body, requestId }) =>
    created(await createCorrection(db, user, body, requestId)),
);
