import { defineRoute } from '@elevate/server-kit';
import { istToday } from '../../../../domain/dates';
import { saveDraft, teamDay } from '../../../../server/eod-reports';
import { eodDraftBody, eodTeamQuery } from '../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/eod-reports?date= — Team view for a day (reviewers): who reported, plus blocked tasks. */
export const GET = defineRoute(
  { permission: 'ops:eod:review', query: eodTeamQuery },
  async ({ user, db, query }) => teamDay(db, user, query.date ?? istToday(new Date())),
);

/** POST /ops/api/v1/eod-reports — Build or refresh your draft for a day; saves `summary` when given. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: eodDraftBody },
  async ({ user, db, body, requestId }) => saveDraft(db, user, body, requestId),
);
