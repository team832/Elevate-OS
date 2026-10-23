import { defineRoute } from '@elevate/server-kit';
import { draftReport, reportDraftBody } from '../../../../../server/ai-drafts';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/ai/report-draft — AI draft of your own report's narrative from your own recorded work (nothing saved). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: reportDraftBody, maxBodyBytes: 4096 },
  async ({ user, db, body, requestId }) => ({
    items: await draftReport(db, user, body, requestId),
  }),
);
