import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { withdrawPublicationBody } from '@elevate/shared-contracts';
import { withdrawPublication } from '../../../../../../../../server/assessments';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/publications/:version/withdraw — take published results back, with a reason. */
export const POST = defineRoute(
  {
    permission: 'ops:assessments:publish',
    params: z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }),
    body: withdrawPublicationBody,
  },
  async ({ user, params, body }) => withdrawPublication(user, params.id, params.version, body),
);
