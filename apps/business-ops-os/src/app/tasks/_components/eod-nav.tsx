import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Subnav } from '@elevate/shared-ui';

const AREAS = [
  ['day', 'My day', '/ops/tasks'],
  ['all', 'Tracker', '/ops/tasks?tab=all'],
  ['inbox', 'Inbox', '/ops/tasks/inbox'],
  ['reports', 'Reports', '/ops/tasks/reports'],
  ['imports', 'Imports', '/ops/tasks/imports'],
  ['eod', 'End-of-day report', '/ops/tasks?tab=eod'],
] as const;
export type TasksArea = (typeof AREAS)[number][0];

/** Task areas; Inbox shows for EOD reviewers and managers, Imports with ops:tasks:import. */
export function TasksNav({
  user,
  current,
  inbox,
}: {
  user: AuthenticatedUser;
  current: TasksArea;
  inbox: boolean;
}) {
  const shown = AREAS.filter(
    ([key]) => (key !== 'inbox' || inbox) && (key !== 'imports' || can(user, 'ops:tasks:import')),
  );
  return (
    <Subnav
      label="Task areas"
      items={shown.map(([, label, href]) => [href, label])}
      current={AREAS.find(([key]) => key === current)?.[2]}
    />
  );
}
