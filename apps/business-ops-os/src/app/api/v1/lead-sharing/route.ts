import { created, defineRoute } from '@elevate/server-kit';
import { saveSharingRule, sharingRuleBody, sharingRulesCsv } from '../../../../server/lead-sharing';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/lead-sharing — the lead sharing rules as a spreadsheet (CSV). */
export const GET = defineRoute({ permission: 'ops:leads:assign' }, async ({ user, db }) =>
  sharingRulesCsv(db, user),
);

/** POST /ops/api/v1/lead-sharing — Save the rule of a programme or the default rule (replaces it). */
export const POST = defineRoute(
  { permission: 'ops:leads:assign', body: sharingRuleBody },
  async ({ user, db, body, requestId }) =>
    created(await saveSharingRule(db, user, body, requestId)),
);
