import { created, defineRoute } from '@elevate/server-kit';
import { listCorrections, requestCorrection } from '../../../../../server/attendance-corrections';
import { correctionBody, correctionListQuery } from '../../../../../server/attendance-schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/attendance/corrections — Correction requests, newest first; own scope = your own. */
export const GET = defineRoute(
  { permission: 'ops:attendance:read', query: correctionListQuery },
  async ({ user, db, query }) => listCorrections(db, user, query),
);

/** POST <base>/api/v1/attendance/corrections — Ask HR to correct one of your days (reason required; one waiting request per day, else 409). */
export const POST = defineRoute(
  { permission: 'ops:attendance:request', body: correctionBody, idempotency: 'optional' },
  async ({ user, db, body, requestId }) =>
    created(await requestCorrection(db, user, body, requestId)),
);
