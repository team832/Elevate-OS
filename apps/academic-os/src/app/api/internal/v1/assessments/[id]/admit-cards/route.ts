import { defineInternalRoute, defineInternalWriteRoute } from '@elevate/server-kit';
import { admitCardWriteBody } from '@elevate/shared-contracts';
import { internalActor } from '../../../../../../../server/services/assessment-ops';
import { admitCardsFor, writeAdmitCards } from '../../../../../../../server/services/admit-cards';
import { idParams } from '../../_write';

export const dynamic = 'force-dynamic';

/** GET /academic/api/internal/v1/assessments/{id}/admit-cards — academic.admit_cards v1 (caller ops, F4-03). */
export const GET = defineInternalRoute(
  { callers: ['ops'], params: idParams },
  async ({ db, params }) => admitCardsFor(db, params.id),
);

/** POST — give roll numbers, or set the venue and instructions (audited under the acting user). */
export const POST = defineInternalWriteRoute(
  { callers: ['ops'], params: idParams, body: admitCardWriteBody },
  async ({ db, params, body, actingUserId, requestId }) =>
    writeAdmitCards(db, await internalActor(db, actingUserId, requestId), params.id, body),
);
