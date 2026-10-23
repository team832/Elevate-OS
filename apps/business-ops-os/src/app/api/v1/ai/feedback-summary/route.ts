import { defineRoute } from '@elevate/server-kit';
import { z } from 'zod';
import { draftFeedbackSummary } from '../../../../../server/ai-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/feedback-summary — AI draft of a summary's strengths and areas to improve (nothing saved). */
export const POST = defineRoute(
  {
    permission: 'ops:teacher_feedback:manage',
    body: z.object({ summaryId: z.uuid() }),
    maxBodyBytes: 4096,
  },
  async ({ user, db, body, requestId }) => ({
    items: await draftFeedbackSummary(db, user, body.summaryId, requestId),
  }),
);
