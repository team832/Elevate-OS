import { created, defineRoute } from '@elevate/server-kit';
import { reviewAckBody } from '../../../../server/report-schemas';
import { acknowledgeReview } from '../../../../server/review-acks';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/review-acks — acknowledge a teacher's submitted review (Academic OS) and add an Ops follow-up. */
export const POST = defineRoute(
  { permission: 'ops:feedback:acknowledge', body: reviewAckBody },
  async ({ user, db, body, requestId }) =>
    created(await acknowledgeReview(db, user, body, requestId)),
);
