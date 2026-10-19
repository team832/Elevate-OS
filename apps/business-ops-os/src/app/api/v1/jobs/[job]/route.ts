import { defineRoute } from '@elevate/server-kit';
import { processEnrolmentReplies } from '../../../../../server/enrolment';
import { runTaskEscalations } from '../../../../../server/escalations';
import { runFollowUpReminders } from '../../../../../server/follow-ups';
import { jobParams } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/jobs/{job} — run an Ops job by hand (a scheduler is a wave-3
 * integration item): `follow-up-reminders`, `task-escalations` or
 * `enrolment-replies` (consumer `ops.enrolment-replies`). Each job is idempotent.
 */
export const POST = defineRoute(
  { permission: 'ops:jobs:run', params: jobParams },
  async ({ user, db, params, requestId }) => {
    switch (params.job) {
      case 'follow-up-reminders':
        return runFollowUpReminders(db, { actor: user, requestId });
      case 'task-escalations':
        return runTaskEscalations(db, { actor: user, requestId });
      case 'enrolment-replies':
        return processEnrolmentReplies(db, { actor: user });
    }
  },
);
