import { z } from 'zod';
import { ValidationError, defineRoute } from '@elevate/server-kit';
import { CALENDAR_ACTIONS } from '../../../../../../domain/calendar';
import {
  actOnCalendarItem,
  calendarActionBody,
  moveCalendarItem,
} from '../../../../../../server/calendar';

export const dynamic = 'force-dynamic';

const params = z.object({
  id: z.uuid(),
  // URL spelling: request-changes for request_changes.
  action: z
    .enum([...CALENDAR_ACTIONS, 'request-changes', 'move'])
    .refine((a) => a !== 'request_changes')
    .transform((a) => (a === 'request-changes' ? 'request_changes' : a)),
});

/**
 * POST /marketing/api/v1/calendar-items/:id/:action — plan | start | submit | approve |
 * request-changes | schedule | publish | cancel | move. Each action re-checks its own permission.
 */
export const POST = defineRoute(
  {
    permission: {
      anyOf: [
        'marketing:calendar:write',
        'marketing:content:approve',
        'marketing:schedule:manage',
        'marketing:content:publish',
      ],
    },
    params,
    body: calendarActionBody,
  },
  async ({ db, params: p, body, user, requestId }) => {
    if (p.action !== 'move') return actOnCalendarItem(db, user, p.id, p.action, body, requestId);
    if (!body.plannedAt) throw new ValidationError('Give the new date and time.');
    return moveCalendarItem(db, user, p.id, body.plannedAt, requestId);
  },
);
