import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { unschedulePlacement } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — scheduled -> planned (original publish time kept). */
export const POST = defineRoute(
  { permission: 'marketing:schedule:manage', params: idParams },
  async ({ db, params, user, requestId }) => unschedulePlacement(db, user, params.id, requestId),
);
