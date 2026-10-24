import { defineRoute } from '@elevate/server-kit';
import { correctRoster } from '../../../../../../../server/assessments';
import { correctionBody } from '../../../../../../../server/assessments-schemas';
import { idParams } from '../../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/roster/corrections: add, remove or restore a student, with a reason. */
export const POST = defineRoute(
  { permission: 'ops:assessments:manage', params: idParams, body: correctionBody },
  async ({ db, user, params, body }) => correctRoster(db, user, params.id, body),
);
