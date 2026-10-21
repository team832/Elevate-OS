import { created, defineRoute } from '@elevate/server-kit';
import { listAppointments, scheduleAppointment } from '../../../../server/appointments';
import { appointmentBody, appointmentListQuery } from '../../../../server/appointments-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/appointments — Appointments, filtered (type, status, staff, student, IST date range). */
export const GET = defineRoute(
  { permission: 'ops:appointments:read', query: appointmentListQuery },
  async ({ user, db, query }) => listAppointments(db, user, query),
);

/** POST /ops/api/v1/appointments — Schedule; 409 names the clashing appointment. */
export const POST = defineRoute(
  { permission: 'ops:appointments:manage', body: appointmentBody },
  async ({ user, db, body, requestId }) =>
    created(await scheduleAppointment(db, user, body, requestId)),
);
