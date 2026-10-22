import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Subnav } from '@elevate/shared-ui';

const AREAS = [
  ['day', 'My day', '/tasks'],
  ['all', 'Tracker', '/tasks?tab=all'],
  ['inbox', 'Inbox', '/tasks/inbox'],
  ['reports', 'Reports', '/tasks/reports'],
  ['imports', 'Imports', '/tasks/imports'],
  ['eod', 'End-of-day report', '/tasks?tab=eod'],
] as const;
export type TasksArea = (typeof AREAS)[number][0];

/** Task areas; Inbox shows for EOD reviewers and managers, Imports (Ops only) with ops:tasks:import. */
export function TasksNav({
  user,
  current,
  inbox,
  base,
}: {
  user: AuthenticatedUser;
  current: TasksArea;
  inbox: boolean;
  base: string;
}) {
  const shown = AREAS.filter(
    ([key]) =>
      (key !== 'inbox' || inbox) &&
      (key !== 'imports' || (base === '/ops' && can(user, 'ops:tasks:import'))),
  );
  return (
    <Subnav
      label="Task areas"
      items={shown.map(([, label, path]) => [`${base}${path}`, label])}
      current={`${base}${AREAS.find(([key]) => key === current)![2]}`}
    />
  );
}
