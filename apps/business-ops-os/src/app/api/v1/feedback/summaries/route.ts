import { created, defineRoute } from '@elevate/server-kit';
import { summaryBody } from '../../../../../server/feedback-schemas';
import { createSummary } from '../../../../../server/feedback-summaries';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/feedback/summaries — Start a draft summary for a teacher and period (counts approved feedback). */
export const POST = defineRoute(
  { permission: 'ops:teacher_feedback:manage', body: summaryBody },
  async ({ user, db, body, requestId }) => created(await createSummary(db, user, body, requestId)),
);
