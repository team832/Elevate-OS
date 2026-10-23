import { defineRoute } from '@elevate/server-kit';
import { mySummary } from '../../../../../../server/feedback-teacher';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/feedback/mine/:id — One of the signed-in teacher's approved summaries; 404 otherwise. */
export const GET = defineRoute(
  { permission: 'ops:teacher_feedback_summaries:read', params: idParams },
  async ({ user, db, params }) => mySummary(db, user, params.id),
);
