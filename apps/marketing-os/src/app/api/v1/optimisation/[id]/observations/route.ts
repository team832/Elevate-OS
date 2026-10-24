import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { addObservation, observationBody } from '../../../../../../server/optimisation';

export const dynamic = 'force-dynamic';

/** POST /marketing/api/v1/optimisation/:id/observations — log a manual observation (append-only). */
export const POST = defineRoute(
  {
    permission: 'marketing:optimisation:write',
    params: z.object({ id: z.uuid() }),
    body: observationBody,
    idempotency: 'optional',
  },
  async ({ db, params, body, user, requestId }) =>
    created(await addObservation(db, user, params.id, body, requestId)),
);
