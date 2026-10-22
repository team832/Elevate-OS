import type { Database } from '@elevate/database';
import { defineRoute } from '@elevate/server-kit';
import type { Actor } from '../../../../../server/context';
import { syncDemosFromAcademic } from '../../../../../server/demos';
import { processEnrolmentReplies } from '../../../../../server/enrolment';
import { runFollowUpReminders } from '../../../../../server/follow-ups';
import { processLeadIntake } from '../../../../../server/lead-intake';
import { jobParams, type OPS_JOBS } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

type Run = (db: Database, actor: Actor, requestId: string) => Promise<unknown>;

/** Every job is idempotent; jobs taking an actor re-check `ops:jobs:run` themselves. */
const JOBS: Record<(typeof OPS_JOBS)[number], Run> = {
  'follow-up-reminders': (db, actor, requestId) => runFollowUpReminders(db, { actor, requestId }),
  'enrolment-replies': (db, actor) => processEnrolmentReplies(db, { actor }),
  'lead-intake': (db, actor, requestId) => processLeadIntake(db, { actor, requestId }),
  'demo-academic-marks': (db, actor, requestId) => syncDemosFromAcademic(db, actor, requestId),
};

/**
 * POST /ops/api/v1/jobs/{job} — run an Ops job by hand (a scheduler is a wave-3
 * integration item). Jobs: see `OPS_JOBS` in server/schemas.ts.
 */
export const POST = defineRoute(
  { permission: 'ops:jobs:run', params: jobParams },
  async ({ user, db, params, requestId }) => JOBS[params.job](db, user, requestId),
);
