import { defineRoute } from '@elevate/server-kit';
import { publishTest } from '../../../../../../server/assessments';
import { publishBody } from '../../../../../../server/assessments-schemas';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/publications: finalise if needed, then publish the next version. */
export const POST = defineRoute(
  { permission: 'ops:assessments:publish', params: idParams, body: publishBody },
  async ({ user, params, body }) => publishTest(user, params.id, body),
);
