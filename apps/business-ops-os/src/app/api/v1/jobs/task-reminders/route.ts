import { defineRoute } from '@elevate/server-kit';
import { runTaskReminders } from '../../../../../server/escalations';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/jobs/task-reminders — run the task reminder job by hand
 * (due-soon and overdue reminders, once per task and due date). A static
 * segment, so it sits beside `jobs/[job]` without changing it.
 */
export const POST = defineRoute({ permission: 'ops:jobs:run' }, async ({ user, db, requestId }) =>
  runTaskReminders(db, { actor: user, requestId }),
);
