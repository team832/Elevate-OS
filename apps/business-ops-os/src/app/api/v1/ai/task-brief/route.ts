import { defineRoute } from '@elevate/server-kit';
import { draftTaskBrief, taskBriefBody } from '../../../../../server/ai-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/task-brief — AI draft of a task brief from a rough line (nothing saved). */
export const POST = defineRoute(
  { permission: 'ops:tasks:review', body: taskBriefBody, maxBodyBytes: 16_384 },
  async ({ user, db, body, requestId }) => ({
    items: await draftTaskBrief(db, user, body, requestId),
  }),
);
