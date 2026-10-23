import { defineRoute } from '@elevate/server-kit';
import { myFeedback } from '../../../../../server/feedback-teacher';

export const dynamic = 'force-dynamic';

/** GET <base>/api/v1/feedback/mine — The signed-in teacher's approved feedback summaries and agreed actions (never raw rows). */
export const GET = defineRoute(
  { permission: 'ops:teacher_feedback_summaries:read' },
  async ({ user, db }) => myFeedback(db, user),
);
