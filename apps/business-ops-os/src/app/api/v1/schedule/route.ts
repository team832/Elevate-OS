import { defineRoute } from '@elevate/server-kit';
import { listSchedule } from '../../../../server/schedule';
import { scheduleQuery } from '../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/schedule — Counselling and demos in a date range (default this IST week). */
export const GET = defineRoute(
  { permission: 'ops:leads:read', query: scheduleQuery },
  async ({ user, db, query }) => listSchedule(db, user, query),
);
