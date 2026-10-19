import { created, defineRoute } from '@elevate/server-kit';
import { createHoliday, listHolidays } from '../../../../../server/hr/shifts';
import { createHolidayBody, holidayListQuery } from '../../../../../server/hr/time-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/holidays — company holiday calendar. */
export const GET = defineRoute(
  { permission: { anyOf: ['ops:shifts:read', 'ops:leave:read'] }, query: holidayListQuery },
  async ({ user, db, query }) => listHolidays(db, user, query),
);

/** POST /ops/api/v1/hr/holidays — record a holiday (starts proposed). */
export const POST = defineRoute(
  { permission: 'ops:leave:manage', body: createHolidayBody },
  async ({ user, db, body, requestId }) => created(await createHoliday(db, user, body, requestId)),
);
