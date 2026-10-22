import { defineRoute } from '@elevate/server-kit';
import { saveDraft } from '../../../../server/eod-reports';
import { eodInbox } from '../../../../server/eod-review';
import { eodDraftBody, eodInboxQuery } from '../../../../server/eod-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports — Manager inbox: submitted reports sent to you (EOD reviewers: all), filtered. */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: eodInboxQuery },
  async ({ user, db, query }) => eodInbox(db, user, query),
);

/** POST /ops/api/v1/eod-reports — Build or refresh your draft for a day; saves summary, next-day plan and notes when given (`version` guards concurrent edits). */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: eodDraftBody },
  async ({ user, db, body, requestId }) => saveDraft(db, user, body, requestId),
);
