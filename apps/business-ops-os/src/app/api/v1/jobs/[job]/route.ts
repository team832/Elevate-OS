import { defineRoute } from '@elevate/server-kit';
import { jobKey, runJob } from '../../../../../server/jobs';
import { jobParams, settingBody } from '../../../../../server/schemas';
import { updateSetting } from '../../../../../server/settings';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/jobs/{job} — run an Ops job now, as the signed-in person; the run is recorded
 * as the job's last run. Jobs: `OPS_JOBS` in server/schemas.ts; screens: JobsPanel, Settings.
 */
export const POST = defineRoute(
  { permission: 'ops:jobs:run', params: jobParams },
  async ({ user, db, params, requestId }) => runJob(db, params.job, requestId, async () => user),
);

/**
 * PUT /ops/api/v1/jobs/{job} — `{ value: { enabled, everyMinutes }, note? }`: switch the job's
 * background runs on or off and set how often (D-133). Audited; the value stays Proposed.
 */
export const PUT = defineRoute(
  { permission: 'ops:jobs:run', params: jobParams, body: settingBody },
  async ({ user, db, params, body, requestId }) =>
    updateSetting(
      db,
      user,
      { key: jobKey(params.job), value: body.value, note: body.note },
      requestId,
      'ops:jobs:run',
    ),
);
