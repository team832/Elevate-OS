import { created, defineRoute } from '@elevate/server-kit';
import { actionBody } from '../../../../../server/feedback-schemas';
import { createAction } from '../../../../../server/feedback-summaries';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/feedback/actions — Record a development action agreed with a teacher. */
export const POST = defineRoute(
  { permission: 'ops:teacher_feedback:manage', body: actionBody },
  async ({ user, db, body, requestId }) => created(await createAction(db, user, body, requestId)),
);
