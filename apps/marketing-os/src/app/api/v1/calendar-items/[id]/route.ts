import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  getCalendarItem,
  updateCalendarItem,
  updateCalendarItemBody,
} from '../../../../../server/calendar';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

/** GET /marketing/api/v1/calendar-items/:id */
export const GET = defineRoute(
  { permission: 'marketing:calendar:read', params },
  async ({ db, params: p }) => getCalendarItem(db, p.id),
);

/** PATCH /marketing/api/v1/calendar-items/:id — before review or after changes are requested. */
export const PATCH = defineRoute(
  { permission: 'marketing:calendar:write', params, body: updateCalendarItemBody },
  async ({ db, params: p, body, user, requestId }) =>
    updateCalendarItem(db, user, p.id, body, requestId),
);
