import { defineRoute } from '@elevate/server-kit';
import { changeAppointment, getAppointment } from '../../../../../server/appointments';
import { appointmentChangeBody } from '../../../../../server/appointments-schemas';
import { editEvent } from '../../../../../server/events';
import { idParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/appointments/:id — Appointment with participants, change history and (events) messages. */
export const GET = defineRoute(
  { permission: 'ops:appointments:read', params: idParams },
  async ({ user, db, params }) => getAppointment(db, user, params.id),
);

/** PATCH /ops/api/v1/appointments/:id — confirm | reschedule | cancel | complete; `edit` an event's details. */
export const PATCH = defineRoute(
  { permission: 'ops:appointments:manage', params: idParams, body: appointmentChangeBody },
  async ({ user, db, params, body, requestId }) =>
    body.action === 'edit'
      ? editEvent(db, user, params.id, body, requestId)
      : changeAppointment(db, user, params.id, body, requestId),
);
