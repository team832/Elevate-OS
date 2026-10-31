/**
 * "Background jobs" on the Overview, for holders of `ops:jobs:run`. There is no scheduler: each job
 * runs when a person presses its button. Who runs them and how often is the owner's question.
 */
import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Card } from '@elevate/shared-ui';
import type { OPS_JOBS } from '../../server/schemas';
import { ActionForm } from '../../ui/action-form';

const JOBS: Record<(typeof OPS_JOBS)[number], { label: string; does: string }> = {
  'enrolment-replies': {
    label: 'Apply Academic replies',
    does: 'Moves confirmed admissions to enrolled, or back to admitted with the reason Academic gave.',
  },
  'enrolment-exits': {
    label: 'Send exits to Academic',
    does: 'Ends the Academic enrolment of every student whose exit was recorded here, and passes on corrected student names.',
  },
  'follow-up-reminders': {
    label: 'Send follow-up reminders',
    does: 'Reminds owners of follow-ups due today or overdue.',
  },
  'task-reminders': {
    label: 'Send task reminders',
    does: 'Reminds people of tasks due soon, overdue or not yet acknowledged.',
  },
  'demo-academic-marks': {
    label: 'Read demo attendance from Academic',
    does: 'Reads the marks teachers made in Academic for open demos. A demo with every class recorded shows as all classes recorded and, if the student attended, its case moves to Demo attended. Nothing is copied.',
  },
  housekeeping: {
    label: 'Clear expired sign-ins',
    does: 'Deletes sign-in sessions that ended over 30 days ago and form keys that have expired. The audit trail and event history stay.',
  },
};

export function JobsPanel({ user }: { user: AuthenticatedUser }) {
  if (!can(user, 'ops:jobs:run')) return null;
  return (
    <Card
      title="Background jobs"
      description="Nothing here runs by itself. Each job runs when you press its button, and running one twice is safe."
    >
      <div className="el-stack">
        {Object.entries(JOBS).map(([job, { label, does }]) => (
          <div key={job}>
            <p className="el-field-hint">{does}</p>
            <ActionForm
              action={`/ops/api/v1/jobs/${job}`}
              submitLabel={label}
              variant="secondary"
              compact
              successText="Done."
              showCounts
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
