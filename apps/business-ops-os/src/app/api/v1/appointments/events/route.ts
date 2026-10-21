import { created, defineRoute } from '@elevate/server-kit';
import { eventBody } from '../../../../../server/appointments-schemas';
import { scheduleEvent } from '../../../../../server/events';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/appointments/events — Schedule an event or webinar; snapshots the audience, sends nothing. */
export const POST = defineRoute(
  { permission: 'ops:appointments:manage', body: eventBody },
  async ({ user, db, body, requestId }) => created(await scheduleEvent(db, user, body, requestId)),
);
