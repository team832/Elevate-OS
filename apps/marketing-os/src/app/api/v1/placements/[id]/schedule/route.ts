import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { scheduleBody, schedulePlacement } from '../../../../../../server';

export const dynamic = 'force-dynamic';
const idParams = z.object({ id: z.uuid() });

/** POST — schedule/reschedule. Hard conflicts -> 409 with details.hard; warnings are returned. */
export const POST = defineRoute(
  { permission: 'marketing:schedule:manage', params: idParams, body: scheduleBody },
  async ({ db, params, body, user, requestId }) =>
    schedulePlacement(db, user, params.id, body, requestId),
);
