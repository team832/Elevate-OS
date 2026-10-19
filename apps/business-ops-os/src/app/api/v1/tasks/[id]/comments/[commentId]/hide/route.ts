import { defineRoute } from '@elevate/server-kit';
import { hideTaskComment } from '../../../../../../../../server/tasks';
import { commentParams, hideCommentBody } from '../../../../../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/tasks/[id]/comments/[commentId]/hide — Hide a comment with a reason (author or manager). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', params: commentParams, body: hideCommentBody },
  async ({ user, db, params, body, requestId }) =>
    hideTaskComment(db, user, params.id, params.commentId, body, requestId),
);
