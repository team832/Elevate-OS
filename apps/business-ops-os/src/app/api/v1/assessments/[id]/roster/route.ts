import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { snapshotRoster } from '../../../../../../server/assessments';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/roster: take the roster from the eligible batches (once). */
export const POST = defineRoute(
  { permission: 'ops:assessments:manage', params: idParams, body: z.strictObject({}) },
  async ({ db, user, params }) => snapshotRoster(db, user, params.id),
);
