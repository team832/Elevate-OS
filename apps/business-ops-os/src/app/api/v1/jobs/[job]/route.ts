import type { Database } from '@elevate/database';
import { defineRoute } from '@elevate/server-kit';
import type { Actor } from '../../../../../server/context';
import { syncDemosFromAcademic } from '../../../../../server/demos';
import { processEnrolmentReplies } from '../../../../../server/enrolment';
import { runFollowUpReminders } from '../../../../../server/follow-ups';
import { runHousekeeping } from '../../../../../server/housekeeping';
import { jobParams, type OPS_JOBS } from '../../../../../server/schemas';
import { sendEnrolmentExits } from '../../../../../server/student-lifecycle';
import { runTaskReminders } from '../../../../../server/task-reminders';

export const dynamic = 'force-dynamic';

type Run = (db: Database, actor: Actor, requestId: string) => Promise<unknown>;

/** Every job is idempotent; jobs taking an actor re-check `ops:jobs:run` themselves. */
const JOBS: Record<(typeof OPS_JOBS)[number], Run> = {
  'follow-up-reminders': (db, actor, requestId) => runFollowUpReminders(db, { actor, requestId }),
  'enrolment-replies': (db, actor) => processEnrolmentReplies(db, { actor }),
  'demo-academic-marks': (db, actor, requestId) => syncDemosFromAcademic(db, actor, requestId),
  'task-reminders': (db, actor, requestId) => runTaskReminders(db, { actor, requestId }),
  'enrolment-exits': (_db, actor) => sendEnrolmentExits(actor),
  housekeeping: (db, actor, requestId) => runHousekeeping(db, actor, requestId),
};

/**
 * POST /ops/api/v1/jobs/{job} — run an Ops job by hand (there is no scheduler; who runs them and
 * how often is the owner's question). Jobs: see `OPS_JOBS` in server/schemas.ts; screen: JobsPanel.
 */
export const POST = defineRoute(
  { permission: 'ops:jobs:run', params: jobParams },
  async ({ user, db, params, requestId }) => JOBS[params.job](db, user, requestId),
);
