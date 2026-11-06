/**
 * "Background jobs" on the Overview, for holders of `ops:jobs:run`: one button per job. Switching a
 * job on to run by itself, and its last run, are in Settings → Background jobs (D-133).
 */
import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Card } from '@elevate/shared-ui';
import { SETTING_DEFINITIONS } from '../../domain';
import { OPS_JOBS } from '../../server/schemas';
import { ActionForm } from '../../ui/action-form';

export function JobsPanel({ user }: { user: AuthenticatedUser }) {
  if (!can(user, 'ops:jobs:run')) return null;
  return (
    <Card
      title="Background jobs"
      description="Nothing here runs by itself unless it is switched on in Settings. Each button runs its job now, and running one twice is safe."
    >
      <div className="el-stack">
        <a href="/ops/settings#background-jobs">Switch jobs on or off, and see their last run</a>
        {OPS_JOBS.map((job) => {
          const { label, description } = SETTING_DEFINITIONS[`jobs.${job}`];
          return (
            <div key={job}>
              <p className="el-field-hint">{description}</p>
              <ActionForm
                action={`/ops/api/v1/jobs/${job}`}
                submitLabel={label}
                variant="secondary"
                compact
                successText="Done."
                showCounts
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
