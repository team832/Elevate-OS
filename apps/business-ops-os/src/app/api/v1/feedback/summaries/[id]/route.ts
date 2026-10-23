import { defineRoute } from '@elevate/server-kit';
import { summaryPatchBody } from '../../../../../../server/feedback-schemas';
import { summaryDetail, updateSummary } from '../../../../../../server/feedback-summaries';
import { idParams } from '../../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/feedback/summaries/:id — HR view: the summary, the original comments, actions, the teacher's preview. */
export const GET = defineRoute(
  { permission: 'ops:teacher_feedback:read', params: idParams },
  async ({ user, db, params }) => summaryDetail(db, user, params.id),
);

/** PATCH — `edit` a draft, `approve` it (not about yourself) or `withdraw` it. */
export const PATCH = defineRoute(
  { permission: 'ops:teacher_feedback:manage', params: idParams, body: summaryPatchBody },
  async ({ user, db, params, body, requestId }) =>
    updateSummary(db, user, params.id, body, requestId),
);
