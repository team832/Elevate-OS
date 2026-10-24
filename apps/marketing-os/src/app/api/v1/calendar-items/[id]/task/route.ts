import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { createCalendarTask } from '../../../../../../server/calendar-plan';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

/** POST /marketing/api/v1/calendar-items/:id/task — the item's Ops task, created once (then 200 with the same id). */
export const POST = defineRoute(
  { permission: 'marketing:calendar:write', params },
  async ({ db, params: p, user, requestId }) => {
    const result = await createCalendarTask(db, user, p.id, requestId);
    return result.created ? created(result) : result;
  },
);
