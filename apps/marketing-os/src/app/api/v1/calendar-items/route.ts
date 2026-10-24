import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { CALENDAR_STATUSES } from '../../../../domain/calendar';
import {
  createCalendarItem,
  createCalendarItemBody,
  listCalendarItems,
} from '../../../../server/calendar';

export const dynamic = 'force-dynamic';

const query = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  owner: z.uuid().optional(),
  status: z.enum(CALENDAR_STATUSES).optional(),
  campaign: z.uuid().optional(),
});

/** GET /marketing/api/v1/calendar-items — planned or published in [from, to), by owner, status, campaign. */
export const GET = defineRoute(
  { permission: 'marketing:calendar:read', query },
  async ({ db, query: q }) =>
    listCalendarItems(db, {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      ownerStaffId: q.owner,
      status: q.status,
      campaignId: q.campaign,
    }),
);

/** POST /marketing/api/v1/calendar-items — 201; with plannedAt it starts Planned, else Idea. */
export const POST = defineRoute(
  { permission: 'marketing:calendar:write', body: createCalendarItemBody, idempotency: 'optional' },
  async ({ db, body, user, requestId }) =>
    created(await createCalendarItem(db, user, body, requestId)),
);
