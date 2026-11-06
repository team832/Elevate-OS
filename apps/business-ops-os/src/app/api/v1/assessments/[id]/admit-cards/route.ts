import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { admitCardWriteBody } from '@elevate/shared-contracts';
import { admitCardsPdfFor, writeAdmitCards } from '../../../../../../server/admit-cards';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/assessments/:id/admit-cards?batchId= — admit cards PDF, two per A4, for the test or one batch (F4-03). */
export const GET = defineRoute(
  {
    permission: 'ops:assessments:manage',
    params: idParams,
    query: z.object({ batchId: z.uuid().optional() }),
  },
  async ({ db, user, params, query }) => {
    const { bytes, filename } = await admitCardsPdfFor(db, user, params.id, query.batchId);
    return pdfResponse(bytes, filename);
  },
);

/** POST { action: 'roll_numbers' } | { action: 'venue', venue, instructions } — written in Academic as you. */
export const POST = defineRoute(
  { permission: 'ops:assessments:manage', params: idParams, body: admitCardWriteBody },
  async ({ user, params, body }) => writeAdmitCards(user, params.id, body),
);
