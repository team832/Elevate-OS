import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { manualPublicationBody, recordManualPublication } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — record a real publication (actual time + live link, both required; MKT-025). */
export const POST = defineRoute(
  { permission: 'marketing:content:publish', params: idParams, body: manualPublicationBody },
  async ({ db, params, body, user, requestId }) =>
    created(await recordManualPublication(db, user, params.id, body, requestId)),
);
