import { created, defineRoute } from '@elevate/server-kit';
import {
  participantAddBody,
  participantChangeBody,
} from '../../../../../../server/appointments-schemas';
import { addParticipant, changeParticipant } from '../../../../../../server/events';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/appointments/:id/participants — Add a student to an event by hand. */
export const POST = defineRoute(
  { permission: 'ops:appointments:manage', params: idParams, body: participantAddBody },
  async ({ user, db, params, body, requestId }) =>
    created(await addParticipant(db, user, params.id, body.studentId, requestId)),
);

/** PATCH /ops/api/v1/appointments/:id/participants — Remove (with reason) or record registration/attendance. */
export const PATCH = defineRoute(
  { permission: 'ops:appointments:manage', params: idParams, body: participantChangeBody },
  async ({ user, db, params, body, requestId }) =>
    changeParticipant(db, user, params.id, body, requestId),
);
